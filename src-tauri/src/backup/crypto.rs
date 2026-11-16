//! Passphrase encryption of a backup archive.
//!
//! The key comes from the passphrase through Argon2id with a random salt. The
//! data is sealed with ChaCha20-Poly1305 in chunks, so an archive of any size
//! is processed in constant memory and a tampered, truncated or reordered
//! file is detected.
//!
//! File layout (all integers big endian):
//!
//! ```text
//! "NOTIVABK"   8 bytes   magic
//! version      1 byte    1
//! m_cost       4 bytes   Argon2 memory in KiB
//! t_cost       4 bytes   Argon2 iterations
//! parallelism  4 bytes   Argon2 lanes
//! salt         16 bytes  random
//! chunk_size   4 bytes   plaintext bytes per chunk
//! chunks       repeated: length (4 bytes) + ciphertext (plaintext + 16 byte tag)
//! ```
//!
//! The nonce of a chunk is its index (8 bytes), a flag that is 1 for the last
//! chunk (1 byte) and three zero bytes. Every key is used for one file only,
//! because the salt is random, so nonces never repeat. The whole header is
//! authenticated with every chunk.

use std::io::{self, Read, Write};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{ChaCha20Poly1305, KeyInit, Nonce};
use zeroize::Zeroizing;

use super::BackupError;

pub const MAGIC: &[u8; 8] = b"NOTIVABK";
const VERSION: u8 = 1;
const HEADER_LEN: usize = 8 + 1 + 4 + 4 + 4 + 16 + 4;
const TAG_LEN: usize = 16;

// Small values keep the tests fast in unoptimised builds; the format is the same.
#[cfg(not(test))]
const CHUNK_SIZE: u32 = 1024 * 1024;
#[cfg(test)]
const CHUNK_SIZE: u32 = 4096;
#[cfg(not(test))]
const MEMORY_KIB: u32 = 64 * 1024;
#[cfg(test)]
const MEMORY_KIB: u32 = 1024;
#[cfg(not(test))]
const ITERATIONS: u32 = 3;
#[cfg(test)]
const ITERATIONS: u32 = 1;
const LANES: u32 = 1;

/// Limits for what a file may ask for, so a crafted header cannot make the
/// app allocate gigabytes or hash for minutes.
const MAX_MEMORY_KIB: u32 = 1024 * 1024;
const MAX_ITERATIONS: u32 = 10;
const MAX_LANES: u32 = 8;
const MAX_CHUNK_SIZE: u32 = 16 * 1024 * 1024;

#[derive(Clone, Copy)]
struct Kdf {
    memory_kib: u32,
    iterations: u32,
    lanes: u32,
}

fn derive_key(
    passphrase: &str,
    salt: &[u8; 16],
    kdf: Kdf,
) -> Result<Zeroizing<[u8; 32]>, BackupError> {
    let params =
        Params::new(kdf.memory_kib, kdf.iterations, kdf.lanes, Some(32)).map_err(|error| {
            BackupError::Corrupt(format!("invalid key derivation settings: {error}"))
        })?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(|error| BackupError::Internal(format!("could not derive the key: {error}")))?;
    Ok(key)
}

fn nonce(index: u64, last: bool) -> Nonce {
    let mut bytes = [0u8; 12];
    bytes[..8].copy_from_slice(&index.to_be_bytes());
    bytes[8] = u8::from(last);
    Nonce::from(bytes)
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.to_owned())
}

/// Encrypts everything written to it. [`finish`](Self::finish) must be called:
/// it writes the last chunk that marks the end of the data.
pub struct EncryptWriter<W: Write> {
    inner: W,
    cipher: ChaCha20Poly1305,
    header: [u8; HEADER_LEN],
    chunk_size: usize,
    buffer: Vec<u8>,
    index: u64,
}

impl<W: Write> EncryptWriter<W> {
    pub fn new(mut inner: W, passphrase: &str) -> Result<Self, BackupError> {
        let mut salt = [0u8; 16];
        getrandom::fill(&mut salt)
            .map_err(|error| BackupError::Internal(format!("no random numbers: {error}")))?;
        let kdf = Kdf {
            memory_kib: MEMORY_KIB,
            iterations: ITERATIONS,
            lanes: LANES,
        };
        let key = derive_key(passphrase, &salt, kdf)?;

        let mut header = [0u8; HEADER_LEN];
        header[..8].copy_from_slice(MAGIC);
        header[8] = VERSION;
        header[9..13].copy_from_slice(&kdf.memory_kib.to_be_bytes());
        header[13..17].copy_from_slice(&kdf.iterations.to_be_bytes());
        header[17..21].copy_from_slice(&kdf.lanes.to_be_bytes());
        header[21..37].copy_from_slice(&salt);
        header[37..41].copy_from_slice(&CHUNK_SIZE.to_be_bytes());
        inner.write_all(&header)?;

        Ok(Self {
            inner,
            cipher: ChaCha20Poly1305::new_from_slice(key.as_ref()).expect("the key has 32 bytes"),
            header,
            chunk_size: CHUNK_SIZE as usize,
            buffer: Vec::with_capacity(CHUNK_SIZE as usize),
            index: 0,
        })
    }

    fn seal(&mut self, last: bool) -> io::Result<()> {
        let sealed = self
            .cipher
            .encrypt(
                &nonce(self.index, last),
                Payload {
                    msg: &self.buffer,
                    aad: &self.header,
                },
            )
            .map_err(|_| invalid("could not encrypt"))?;
        self.inner.write_all(&(sealed.len() as u32).to_be_bytes())?;
        self.inner.write_all(&sealed)?;
        self.buffer.clear();
        self.index += 1;
        Ok(())
    }

    /// Writes the last chunk and returns the underlying writer.
    pub fn finish(mut self) -> io::Result<W> {
        self.seal(true)?;
        self.inner.flush()?;
        Ok(self.inner)
    }
}

impl<W: Write> Write for EncryptWriter<W> {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        // A full buffer is only sealed when more data follows, so that the
        // last chunk is always the one `finish` writes.
        if self.buffer.len() == self.chunk_size {
            self.seal(false)?;
        }
        let room = self.chunk_size - self.buffer.len();
        let taken = room.min(data.len());
        self.buffer.extend_from_slice(&data[..taken]);
        Ok(taken)
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Decrypts a file written by [`EncryptWriter`].
pub struct DecryptReader<R: Read> {
    inner: R,
    cipher: ChaCha20Poly1305,
    header: [u8; HEADER_LEN],
    max_chunk: usize,
    plain: Vec<u8>,
    position: usize,
    index: u64,
    done: bool,
}

impl<R: Read> DecryptReader<R> {
    /// Reads the header, derives the key and decrypts the first chunk. A
    /// passphrase that does not fit is reported here, as
    /// [`BackupError::WrongPassphrase`].
    pub fn new(mut inner: R, passphrase: &str) -> Result<Self, BackupError> {
        let mut header = [0u8; HEADER_LEN];
        inner
            .read_exact(&mut header)
            .map_err(|_| BackupError::Corrupt("the file ends inside its header".into()))?;
        if &header[..8] != MAGIC {
            return Err(BackupError::NotABackup);
        }
        if header[8] != VERSION {
            return Err(BackupError::Unsupported(format!(
                "encryption format {}",
                header[8]
            )));
        }
        let word = |at: usize| u32::from_be_bytes(header[at..at + 4].try_into().unwrap());
        let kdf = Kdf {
            memory_kib: word(9),
            iterations: word(13),
            lanes: word(17),
        };
        let chunk_size = word(37);
        if kdf.memory_kib > MAX_MEMORY_KIB
            || kdf.iterations > MAX_ITERATIONS
            || kdf.lanes > MAX_LANES
            || chunk_size == 0
            || chunk_size > MAX_CHUNK_SIZE
        {
            return Err(BackupError::Corrupt("the header is not valid".into()));
        }
        let salt: [u8; 16] = header[21..37].try_into().unwrap();
        let key = derive_key(passphrase, &salt, kdf)?;

        let mut reader = Self {
            inner,
            cipher: ChaCha20Poly1305::new_from_slice(key.as_ref()).expect("the key has 32 bytes"),
            header,
            max_chunk: chunk_size as usize,
            plain: Vec::new(),
            position: 0,
            index: 0,
            done: false,
        };
        // With the right key the first chunk always authenticates, so a
        // failure here means the passphrase is wrong (or the header was
        // changed, which looks the same and is just as unusable).
        match reader.next_chunk() {
            Ok(()) => Ok(reader),
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
                Err(BackupError::WrongPassphrase)
            }
            Err(error) => Err(error.into()),
        }
    }

    fn next_chunk(&mut self) -> io::Result<()> {
        let mut length = [0u8; 4];
        self.inner
            .read_exact(&mut length)
            .map_err(|_| invalid("the encrypted file is cut off"))?;
        let length = u32::from_be_bytes(length) as usize;
        if !(TAG_LEN..=self.max_chunk + TAG_LEN).contains(&length) {
            return Err(invalid("the encrypted file is damaged"));
        }
        let mut sealed = vec![0u8; length];
        self.inner
            .read_exact(&mut sealed)
            .map_err(|_| invalid("the encrypted file is cut off"))?;

        // A chunk that is not the last one is always full, and the last one
        // is the only one that may be shorter. Try both readings of the flag.
        let last = length < self.max_chunk + TAG_LEN;
        let open = |last: bool| {
            self.cipher.decrypt(
                &nonce(self.index, last),
                Payload {
                    msg: &sealed,
                    aad: &self.header,
                },
            )
        };
        let (plain, last) = match open(last) {
            Ok(plain) => (plain, last),
            Err(_) if !last => match open(true) {
                // A full chunk can also be the last one.
                Ok(plain) => (plain, true),
                Err(_) => return Err(self.auth_error()),
            },
            Err(_) => return Err(self.auth_error()),
        };

        self.plain = plain;
        self.position = 0;
        self.index += 1;
        self.done = last;
        if last {
            let mut extra = [0u8; 1];
            if self.inner.read(&mut extra)? != 0 {
                return Err(invalid("there is data after the end of the encrypted file"));
            }
        }
        Ok(())
    }

    /// The first chunk failing means a wrong passphrase; later ones mean damage.
    fn auth_error(&self) -> io::Error {
        if self.index == 0 {
            io::Error::new(io::ErrorKind::PermissionDenied, "wrong passphrase")
        } else {
            invalid("the encrypted file is damaged")
        }
    }
}

impl<R: Read> Read for DecryptReader<R> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        while self.position == self.plain.len() {
            if self.done {
                return Ok(0);
            }
            self.next_chunk()?;
        }
        let count = out.len().min(self.plain.len() - self.position);
        out[..count].copy_from_slice(&self.plain[self.position..self.position + count]);
        self.position += count;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seal(data: &[u8], passphrase: &str) -> Vec<u8> {
        let mut writer = EncryptWriter::new(Vec::new(), passphrase).unwrap();
        writer.write_all(data).unwrap();
        writer.finish().unwrap()
    }

    fn open(file: &[u8], passphrase: &str) -> Result<Vec<u8>, BackupError> {
        let mut reader = DecryptReader::new(file, passphrase)?;
        let mut out = Vec::new();
        reader.read_to_end(&mut out)?;
        Ok(out)
    }

    #[test]
    fn data_survives_a_round_trip_at_every_chunk_boundary() {
        for length in [
            0,
            1,
            CHUNK_SIZE as usize - 1,
            CHUNK_SIZE as usize,
            CHUNK_SIZE as usize + 1,
            2 * CHUNK_SIZE as usize,
            2 * CHUNK_SIZE as usize + 5,
        ] {
            let data: Vec<u8> = (0..length).map(|i| (i % 251) as u8).collect();
            let file = seal(&data, "correct horse");
            assert_eq!(open(&file, "correct horse").unwrap(), data, "{length}");
        }
    }

    #[test]
    fn the_file_does_not_contain_the_plain_text() {
        let file = seal(b"a very recognisable sentence", "pw");

        assert!(!file.windows(10).any(|window| window == b"recognisab"));
    }

    #[test]
    fn a_wrong_passphrase_is_reported_as_such() {
        let file = seal(b"secret", "right");

        assert!(matches!(
            open(&file, "wrong"),
            Err(BackupError::WrongPassphrase)
        ));
    }

    #[test]
    fn a_changed_byte_is_detected() {
        let mut file = seal(b"secret data", "pw");
        let last = file.len() - 1;
        file[last] ^= 1;

        assert!(matches!(
            open(&file, "pw"),
            Err(BackupError::WrongPassphrase)
        ));

        // Damage in a later chunk is damage, not a wrong passphrase.
        let data = vec![7u8; CHUNK_SIZE as usize * 2 + 10];
        let mut file = seal(&data, "pw");
        let last = file.len() - 1;
        file[last] ^= 1;
        assert!(matches!(open(&file, "pw"), Err(BackupError::Corrupt(_))));
    }

    #[test]
    fn a_truncated_file_is_detected() {
        let data = vec![7u8; CHUNK_SIZE as usize * 2 + 10];
        let file = seal(&data, "pw");

        // Cut at a chunk boundary: the chunks that remain are all valid, but
        // none of them is marked as the last one.
        let first = HEADER_LEN + 4 + CHUNK_SIZE as usize + TAG_LEN;
        let second = first + 4 + CHUNK_SIZE as usize + TAG_LEN;
        for cut in [first, second, file.len() - 3, HEADER_LEN - 1] {
            assert!(
                matches!(open(&file[..cut], "pw"), Err(BackupError::Corrupt(_))),
                "cut at {cut}"
            );
        }
    }

    #[test]
    fn a_crafted_header_cannot_demand_unbounded_work() {
        let mut file = seal(b"x", "pw");
        file[9..13].copy_from_slice(&u32::MAX.to_be_bytes());

        assert!(matches!(open(&file, "pw"), Err(BackupError::Corrupt(_))));
    }

    #[test]
    fn two_files_of_the_same_data_differ() {
        assert_ne!(seal(b"same", "pw"), seal(b"same", "pw"));
    }
}
