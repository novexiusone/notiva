//! Image files that belong to pages.
//!
//! Images are stored as files next to the database, never inside it. Blocks
//! refer to them by a URL of the app's own `notiva-image` scheme, so no
//! absolute path is ever stored or handed to the frontend.

use std::path::{Path, PathBuf};

/// The URL scheme under which stored images are served to the WebView.
pub const SCHEME: &str = "notiva-image";

const MAX_BYTES: usize = 20 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ImageError {
    #[error("the image is larger than 20 MiB")]
    TooLarge,

    #[error("only PNG, JPEG, GIF and WebP images are supported")]
    Unsupported,

    #[error("could not store the image: {0}")]
    Io(#[from] std::io::Error),
}

struct Format {
    extension: &'static str,
    mime: &'static str,
}

const FORMATS: [Format; 4] = [
    Format {
        extension: "png",
        mime: "image/png",
    },
    Format {
        extension: "jpg",
        mime: "image/jpeg",
    },
    Format {
        extension: "gif",
        mime: "image/gif",
    },
    Format {
        extension: "webp",
        mime: "image/webp",
    },
];

/// Recognises a format by the first bytes of the file, not by its name.
fn sniff(bytes: &[u8]) -> Option<&'static Format> {
    let extension = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "jpg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "gif"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "webp"
    } else {
        return None;
    };

    FORMATS.iter().find(|format| format.extension == extension)
}

pub struct ImageStore {
    directory: PathBuf,
}

impl ImageStore {
    pub fn open(directory: &Path) -> Result<Self, ImageError> {
        std::fs::create_dir_all(directory)?;
        Ok(Self {
            directory: directory.to_owned(),
        })
    }

    /// Stores an image under a new name and returns the URL that refers to it.
    pub fn save(&self, bytes: &[u8]) -> Result<String, ImageError> {
        if bytes.len() > MAX_BYTES {
            return Err(ImageError::TooLarge);
        }
        let format = sniff(bytes).ok_or(ImageError::Unsupported)?;

        let name = format!("{}.{}", uuid::Uuid::new_v4().simple(), format.extension);
        std::fs::write(self.directory.join(&name), bytes)?;

        Ok(format!("{SCHEME}://localhost/{name}"))
    }

    /// Reads a stored image by its file name. Returns the bytes and their
    /// media type, or nothing when the name is not one this store gave out.
    pub fn read(&self, name: &str) -> Option<(Vec<u8>, &'static str)> {
        let (stem, extension) = name.split_once('.')?;
        // Names are generated here; anything else, such as a path, is refused.
        if stem.len() != 32 || !stem.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        let format = FORMATS
            .iter()
            .find(|format| format.extension == extension)?;

        let bytes = std::fs::read(self.directory.join(name)).ok()?;
        Some((bytes, format.mime))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nrest of the file";

    fn store() -> (tempfile::TempDir, ImageStore) {
        let directory = tempfile::tempdir().unwrap();
        let store = ImageStore::open(&directory.path().join("images")).unwrap();
        (directory, store)
    }

    fn name_of(url: &str) -> &str {
        url.strip_prefix("notiva-image://localhost/")
            .expect("a notiva-image URL")
    }

    #[test]
    fn a_saved_image_can_be_read_back_by_its_url() {
        let (_directory, store) = store();

        let url = store.save(PNG).unwrap();
        let (bytes, mime) = store.read(name_of(&url)).unwrap();

        assert_eq!(bytes, PNG);
        assert_eq!(mime, "image/png");
    }

    #[test]
    fn the_format_is_recognised_from_the_content() {
        let (_directory, store) = store();
        let cases: [(&[u8], &str, &str); 4] = [
            (PNG, ".png", "image/png"),
            (b"\xff\xd8\xff\xe0 jpeg data", ".jpg", "image/jpeg"),
            (b"GIF89a gif data", ".gif", "image/gif"),
            (b"RIFF\x10\x00\x00\x00WEBPVP8 ", ".webp", "image/webp"),
        ];

        for (bytes, extension, mime) in cases {
            let url = store.save(bytes).unwrap();
            assert!(url.ends_with(extension), "{url}");
            assert_eq!(store.read(name_of(&url)).unwrap().1, mime);
        }
    }

    #[test]
    fn every_image_gets_a_name_of_its_own() {
        let (_directory, store) = store();

        assert_ne!(store.save(PNG).unwrap(), store.save(PNG).unwrap());
    }

    #[test]
    fn files_that_are_not_images_are_refused() {
        let (directory, store) = store();

        let error = store.save(b"<svg onload=alert(1)>").unwrap_err();

        assert!(matches!(error, ImageError::Unsupported));
        assert_eq!(
            std::fs::read_dir(directory.path().join("images"))
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn images_over_the_size_limit_are_refused() {
        let (_directory, store) = store();
        let mut bytes = PNG.to_vec();
        bytes.resize(MAX_BYTES + 1, 0);

        assert!(matches!(
            store.save(&bytes).unwrap_err(),
            ImageError::TooLarge
        ));
    }

    #[test]
    fn only_names_the_store_gave_out_can_be_read() {
        let (directory, store) = store();
        std::fs::write(directory.path().join("secret.png"), PNG).unwrap();
        let url = store.save(PNG).unwrap();
        let name = name_of(&url).to_owned();

        assert!(store.read(&name).is_some());
        for attempt in [
            "../secret.png",
            "/etc/passwd",
            "secret.png",
            "",
            &format!("../images/{name}"),
            &name.replace(".png", ".exe"),
            &format!("{}.png", "f".repeat(32)),
        ] {
            assert!(
                store.read(attempt).is_none(),
                "{attempt:?} must not be readable"
            );
        }
    }
}
