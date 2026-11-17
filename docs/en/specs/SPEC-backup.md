# Spec: backup

## Objective

Notiva keeps all data on the machine, so a lost disk or a broken update must not mean lost notes. This module writes a backup of everything the user owns into one archive file, restores it safely, makes backups on a schedule, and can protect an archive with a passphrase.

This is the backend part of #26. It has no user interface; the settings screen and the restore dialog come in a separate package. Remote targets and an encrypted live database are out of scope and tracked as follow-ups (see [Not in this spec](#not-in-this-spec)).

## Decisions

| Question (from #26)                             | Decision                                                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database files or an export?                    | A SurrealDB export (`db.surql`, plain SurrealQL text). Copying live files of a running database is never safe; the export is one read transaction, so it is consistent while the app writes. Anyone can read it as text. |
| What runs the schedule while the app is closed? | Nothing. The schedule runs while the app is open: once at start (a backup is made when the last scheduled one is older than the interval) and then every 5 minutes it checks again. A background service is a follow-up. |
| One file or a folder?                           | One file `*.notiva-backup`: a tar stream compressed with zstd, so it can be unpacked with standard tools.                                                                                                                |
| Does a restore replace data while the app runs? | No. A restore is prepared next to the live data and applied at the next start, before the database is opened.                                                                                                            |
| Are scheduled backups encrypted?                | No, in this package. The passphrase is never stored, and the keychain integration is a follow-up. A manual backup can be encrypted by giving a passphrase.                                                               |
| Which backups does pruning delete?              | Only scheduled ones (`notiva-auto-*`). Manual backups and the safety backups made before a restore are never deleted by the app.                                                                                         |

## Tech stack

| Area       | Choice                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Snapshot   | `Surreal::export` / `import` of the embedded engine, behind `storage` (the only module that imports `surrealdb`)  |
| Container  | `tar` + `zstd`                                                                                                    |
| Checksums  | SHA-256 (`sha2`)                                                                                                  |
| Encryption | ChaCha20-Poly1305 (`chacha20poly1305`, RustCrypto) with a key from Argon2id (`argon2`), keys wiped with `zeroize` |
| Time       | `chrono`                                                                                                          |
| Settings   | `backup-settings.json` in the app data directory                                                                  |

### Why not `age`

`age` is vetted and widely used, but it adds a large dependency tree for a passphrase-only use, and its streaming format is built for files that are read once. RustCrypto's ChaCha20-Poly1305 and Argon2 are the primitives `age` and most password managers are built on, and the RustCrypto crates were already in the dependency tree (SurrealDB uses `argon2`). The construction here is small and has no novel parts: a random salt, a key derived once per file, chunked AEAD with a counter nonce. If the format ever needs to be read by other tools, switching to `age` is a new format version.

## Archive format

```
manifest.json     first entry
db.surql          the database snapshot
images/<name>     one entry per stored image
```

`manifest.json`:

```json
{
  "format": 1,
  "appVersion": "0.8.0",
  "schemaVersion": 10,
  "createdAt": "2026-11-16T10:15:00Z",
  "files": [{ "path": "db.surql", "size": 123, "sha256": "…" }]
}
```

- `schemaVersion` is the highest applied migration of the exported database.
- `files` lists every other entry with its size and SHA-256. Only `db.surql` and `images/<name>` with a name that `media` hands out are accepted, each once, so no entry can point outside the folder it is extracted into.
- The manifest comes first, so a backup can be judged (app version, schema version, whether it can be restored) before anything else is read.

### Encryption

An encrypted backup is the same tar+zstd stream sealed with a passphrase. File layout (big endian):

```
"NOTIVABK" | version 1 | m_cost u32 | t_cost u32 | parallelism u32 | salt 16 | chunk_size u32 | chunks…
chunk = length u32 | ChaCha20-Poly1305 ciphertext (plaintext + 16 byte tag)
```

- Key: Argon2id, 64 MiB, 3 iterations, 1 lane, random 16 byte salt; parameters are in the header so they can change later. A header that asks for more than 256 MiB, 10 iterations or 8 lanes is refused.
- Chunks of 1 MiB. The nonce is the chunk index plus a flag that marks the last chunk; the whole header is authenticated data of every chunk. A changed, reordered or truncated file fails to open.
- A passphrase that does not fit fails on the first chunk and is reported as `wrong_passphrase`; damage later in the file is `corrupt`.
- The passphrase is held in a wrapper that wipes it on drop and has no `Debug` or `Display`. It is never written to disk, a log or an error message. A restore of an encrypted backup uses the same passphrase for the safety backup, so no unencrypted copy of the data appears.
- Plain archives start with the zstd magic, encrypted ones with `NOTIVABK`; anything else is `not a backup`.

## Behaviour

### Creating a backup

1. Export the database to a temporary file inside the app data directory. This is a consistent snapshot while the app keeps writing. The schema version is read first; migrations only run when the database is opened, so it cannot change in between.
2. List the images after the export. An image file is written before the block that refers to it is saved, so everything the snapshot refers to exists by then. Image files are never modified.
3. Hash all files, write the archive as `<name>.partial`, read it back and check every checksum, then rename it. The file appears only when it is complete and verified; a failed backup leaves nothing but the error.
4. Backups are serialised: only one backup or restore runs at a time.

File names: `notiva-backup-<stamp>.notiva-backup` (manual), `notiva-auto-<stamp>…` (scheduled), `notiva-pre-restore-<stamp>…` (safety backup), with `<stamp>` like `20261116T101500Z`. A name that exists gets `-2`, `-3`, … and is never overwritten.

### Restoring

`restore_backup` never changes live data:

1. Read the manifest. A `format` this build does not know is `unsupported`; a `schemaVersion` above what this build supports is `schema_too_new`, refused before any file is extracted.
2. Extract into `restore-staging/`, checking size and SHA-256 of every file against the manifest, then reading to the end of the archive. A missing, extra or doubled entry, a wrong checksum or a cut-off file is `corrupt`.
3. Build the database in `restore-staging/db` from the snapshot (older snapshots are migrated up to the current schema).
4. Only now take a safety backup of the live data into the backup folder. If that fails, the restore stops and the staging folder is removed.
5. Write `pending-restore.json` and tell the caller that a restart is required.

At the next start, before the database is opened, `apply_pending_restore` moves the live `db` and `images` to `restore-previous/` and the staged ones into place, then removes the marker. Every step can be repeated: if the app is killed in the middle, the next start finishes the swap. If the swap fails, the start is aborted instead of opening a half-moved data directory, which would create an empty database. The replaced data stays in `restore-previous/` until the next restore replaces it; the safety backup is the lasting copy. Staged data without a marker is deleted at start.

`restore_backup_to_folder` restores into a new, empty folder outside the data directory and leaves the app's data alone. The folder then holds `db/` and `images/`.

### Schedule

- Settings (`backup-settings.json`, not in the database, so a restore never changes them): `interval` (`manual`, `hourly`, `daily`, `weekly`; default `manual`), `keepLast` (1 to 365, default 7), `folder` (absolute path; default `<app data>/backups`). A folder is created and tried out when saved; folders inside `db`, `images` or the restore folders are refused.
- A scheduler task starts with the app. At start and every 5 minutes it makes a scheduled backup when the newest `notiva-auto-*` file in the folder is older than the interval (or none exists), then prunes. The folder is the only state, so nothing can get out of step with it.
- Pruning runs after a successful, verified backup and keeps the newest `keepLast` scheduled backups. It never deletes manual or safety backups, and never the last scheduled one.
- Scheduled backups are not encrypted (see Decisions).
- Failures are not swallowed: they are kept in `backup_status` (`lastError` until the next success), sent as the `backup-failed` event and printed to stderr. A failed backup is retried at the next tick.

## Commands

| Command                                                   | Result                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| `get_backup_settings()` / `set_backup_settings(settings)` | `Settings`                                                 |
| `create_backup(passphrase?)`                              | `BackupInfo`; a manual backup in the backup folder         |
| `list_backups()`                                          | `BackupInfo[]`, newest first                               |
| `inspect_backup(path, passphrase?)`                       | `BackupSummary`: versions, date, image count, `restorable` |
| `restore_backup(path, passphrase?)`                       | `RestoreOutcome`: `restartRequired`, `safetyBackup`        |
| `restore_backup_to_folder(path, passphrase?, directory)`  | nothing                                                    |
| `backup_status()`                                         | `Status`: `running`, `lastSuccessAt`, `lastError`          |
| `restart_app()`                                           | restarts the app, which applies a prepared restore         |

Error kinds the frontend can act on, besides `not_found`, `invalid` and `internal`: `passphrase_required`, `wrong_passphrase`, `corrupt`, `schema_too_new`, `unsupported`.

## Project structure

```
src-tauri/src/
  backup/
    mod.rs        → service, create, list, prune, schedule check, errors
    archive.rs    → manifest, tar+zstd, checksums
    crypto.rs     → passphrase encryption
    restore.rs    → staging, safety backup, the swap at start
    settings.rs   → settings file
    tests.rs
  storage/backup.rs → export and rebuild of the database (the only code that touches SurrealDB for backups)
  commands/backup.rs
```

## Testing strategy

- Round trip: pages, titles, full-text search and image bytes are identical after backup and restore; plain and encrypted.
- Wrong and missing passphrase give `wrong_passphrase` / `passphrase_required` and leave nothing behind; the passphrase is not in any error text.
- Corrupt archives: a flipped byte, a cut-off file, text that is not an archive, a forged manifest (checksum).
- A backup with a newer schema is refused before extraction and leaves no folder.
- Restore: live data is untouched until the swap, a safety backup exists, the previous data is kept, a second start changes nothing, an interrupted swap is finished, a failed restore schedules nothing, a non-empty target is refused.
- Schedule: due logic per interval, pruning (only scheduled, newest kept, never zero), failure reported in the status.
- Encryption primitives: round trip at chunk boundaries, tampering, truncation at chunk boundaries, oversized header values.

## Limits and known risks

- **Writes between the safety backup and the restart** are only in `restore-previous/db` (the replaced data); the safety backup was taken earlier and does not have them.
- **`restore-previous/` keeps a plaintext database and the images**, even when the backup that was restored was encrypted. It is kept until the next restore is prepared. Deleting it is the user's call until the UI offers it.
- **Declared sizes are not trusted.** Before extraction the manifest sizes are summed (overflow and more than 256 GiB are refused) and twice the total must fit in the free space of the target volume (checked on Unix). Each entry must have exactly the declared size and is never written beyond it.
- **Passphrase.** An empty passphrase is an error, never "no passphrase". Copies of it are wrapped in `Zeroizing`; the Argon2 key is wiped after use, and the cipher key too (`chacha20poly1305` with the `zeroize` feature). The string that arrives from the WebView through Tauri's IPC cannot be wiped by this module.
- **The import of a snapshot** is SurrealQL from a file. It runs on an engine with network targets and scripting denied, but a crafted snapshot can still define schema and events and be expensive. Checksums prove integrity, not trust. Tracked in #151.
- **Which backups the schedule may delete.** Only files that are named `notiva-auto-*`, are not encrypted and whose manifest says `"kind": "auto"`, ordered by the manifest timestamp. A copied, renamed or touched file, or a changed clock, cannot make the app delete the newest backup; a newest backup dated in the future counts as just made.
- **A second restore** is built in `restore-staging.new/` and replaces a pending one only when it is complete and the safety backup exists; a failed second restore keeps the first.
- **At start** leftover `*.partial` files, `pending-restore.json.tmp` and `restore-staging.new/` are removed, and a rename that fails is retried a few times before the start is aborted with a message.
- **After failures** the scheduler waits twice as long each time, up to 6 hours, and starts over after a success.

## Boundaries

- **Always:** Take a safety backup before data is replaced. Verify an archive against its checksums before it is used. Keep SurrealDB types inside `storage`.
- **Ask first:** Changing the archive format (bump `format`), deleting any backup that is not a scheduled one.
- **Never:** Overwrite live data while the app runs. Write or log a passphrase. Edit an applied migration (this module adds none).

## Not in this spec

Each has its own issue; all are `priority: low`.

- Encrypting the live database at rest: #143
- Remote targets (FTP/SFTP, S3 and compatible, WebDAV, cloud drives) with credentials in the macOS keychain: #144
- Encrypted scheduled backups with the passphrase in the keychain, and a schedule that runs while the app is closed: #145
- The user interface: settings, backup list, restore dialog, failure notice.

## Success criteria

- [ ] A backup is one file with a manifest and checksums, made while the app runs (#26)
- [ ] A restore validates first, refuses a newer schema, takes a safety backup and swaps atomically at start (#26)
- [ ] Scheduled local backups with interval, keep-last-N, folder choice and reported failures (#26)
- [ ] Optional passphrase encryption; a wrong passphrase gives a clear error (#26)
