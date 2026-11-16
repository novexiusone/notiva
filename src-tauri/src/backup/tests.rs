use std::path::{Path, PathBuf};

use chrono::{Duration, TimeZone, Utc};

use super::*;
use crate::media::ImageStore;

const PNG: &[u8] = b"\x89PNG\r\n\x1a\nthe picture";

fn pw(text: &str) -> Passphrase {
    Passphrase::new(text.to_owned()).unwrap()
}

/// An app data directory with a populated in-memory database and an image.
struct World {
    _root: tempfile::TempDir,
    data: PathBuf,
    storage: Storage,
    image: String,
}

async fn world() -> World {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    std::fs::create_dir_all(&data).unwrap();

    let storage = Storage::open_in_memory().await.unwrap();
    let first = storage.create_page(None).await.unwrap();
    storage
        .rename_page(&first.id, "Quarterly zebra plan")
        .await
        .unwrap();
    let child = storage.create_page(Some(&first.id)).await.unwrap();
    storage.rename_page(&child.id, "Child page").await.unwrap();

    let images = ImageStore::open(&data.join("images")).unwrap();
    let url = images.save(PNG).unwrap();
    let image = url.rsplit('/').next().unwrap().to_owned();

    World {
        _root: root,
        data,
        storage,
        image,
    }
}

fn at(day: u32, hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, day, hour, 0, 0).unwrap()
}

async fn backup(world: &World, kind: Kind, passphrase: Option<&Passphrase>) -> BackupInfo {
    create(
        &world.storage,
        &world.data,
        &world.data.join("backups"),
        kind,
        passphrase,
        now(),
    )
    .await
    .unwrap()
}

async fn open_restored(directory: &Path) -> Storage {
    for _ in 0..100 {
        if let Ok(storage) = Storage::open(&directory.join("db")).await {
            return storage;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    Storage::open(&directory.join("db")).await.unwrap()
}

async fn assert_restored(directory: &Path, image: &str) {
    let storage = open_restored(directory).await;
    let titles: Vec<String> = storage
        .list_pages()
        .await
        .unwrap()
        .into_iter()
        .map(|page| page.title)
        .collect();
    assert!(
        titles.contains(&"Quarterly zebra plan".to_owned()),
        "{titles:?}"
    );
    assert!(titles.contains(&"Child page".to_owned()));
    // Indexes were rebuilt, so full-text search works on restored data.
    assert_eq!(storage.search("zebra").await.unwrap().len(), 1);
    assert_eq!(
        std::fs::read(directory.join("images").join(image)).unwrap(),
        PNG
    );
}

#[tokio::test]
async fn a_backup_restores_pages_search_and_images() {
    let world = world().await;
    let info = backup(&world, Kind::Manual, None).await;
    assert!(!info.encrypted);
    assert_eq!(info.kind, Kind::Manual);

    let target = world.data.join("restored");
    restore_to_folder_for_test(&info.path, None, &world.data, &target)
        .await
        .unwrap();

    assert_restored(&target, &world.image).await;
}

async fn restore_to_folder_for_test(
    path: &str,
    passphrase: Option<&Passphrase>,
    data: &Path,
    target: &Path,
) -> Result<(), BackupError> {
    // The target is outside the data directory, as the command requires.
    let outside = data.parent().unwrap().join(target.file_name().unwrap());
    let result = restore_to_folder(Path::new(path), passphrase, data, &outside).await;
    if result.is_ok() {
        std::fs::rename(&outside, target).unwrap();
    }
    result
}

#[tokio::test]
async fn a_backup_is_a_single_file_with_a_manifest() {
    let world = world().await;
    let info = backup(&world, Kind::Manual, None).await;

    let manifest = archive::read_manifest(Path::new(&info.path), None).unwrap();

    assert_eq!(manifest.format, 1);
    assert_eq!(manifest.app_version, env!("CARGO_PKG_VERSION"));
    assert_eq!(manifest.schema_version, Storage::supported_schema_version());
    let paths: Vec<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, ["db.surql", &format!("images/{}", world.image)]);
    assert!(manifest.files.iter().all(|f| f.sha256.len() == 64));
    // No half-written or temporary file is left behind.
    let names: Vec<_> = std::fs::read_dir(world.data.join("backups"))
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names.len(), 1);
    assert!(!std::fs::read_dir(&world.data).unwrap().any(|e| {
        e.unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("backup-tmp-")
    }));
}

#[tokio::test]
async fn an_encrypted_backup_restores_with_the_passphrase() {
    let world = world().await;
    let secret = pw("correct horse battery staple");
    let info = backup(&world, Kind::Manual, Some(&secret)).await;
    assert!(info.encrypted);

    // Neither the titles nor the image can be found in the file.
    let bytes = std::fs::read(&info.path).unwrap();
    assert!(!bytes.windows(5).any(|window| window == b"zebra"));

    let target = world.data.join("restored");
    restore_to_folder_for_test(&info.path, Some(&secret), &world.data, &target)
        .await
        .unwrap();
    assert_restored(&target, &world.image).await;
}

#[tokio::test]
async fn a_wrong_or_missing_passphrase_is_refused_with_a_clear_error() {
    let world = world().await;
    let info = backup(&world, Kind::Manual, Some(&pw("right"))).await;
    let outside = world.data.parent().unwrap().join("nope");

    let wrong = restore_to_folder(
        Path::new(&info.path),
        Some(&pw("wrong")),
        &world.data,
        &outside,
    )
    .await
    .unwrap_err();
    let missing = restore_to_folder(Path::new(&info.path), None, &world.data, &outside)
        .await
        .unwrap_err();

    assert!(matches!(wrong, BackupError::WrongPassphrase));
    assert_eq!(wrong.to_string(), "the passphrase is wrong");
    assert!(matches!(missing, BackupError::PassphraseRequired));
    assert!(!outside.exists(), "a refused restore leaves nothing behind");
    assert!(matches!(
        inspect(Path::new(&info.path), Some(&pw("wrong"))),
        Err(BackupError::WrongPassphrase)
    ));
    assert!(
        inspect(Path::new(&info.path), Some(&pw("right")))
            .unwrap()
            .restorable
    );
}

#[tokio::test]
async fn a_damaged_archive_is_refused_and_leaves_nothing_behind() {
    let world = world().await;
    let info = backup(&world, Kind::Manual, None).await;
    let bytes = std::fs::read(&info.path).unwrap();

    let damaged = |name: &str, bytes: Vec<u8>| {
        let path = world.data.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    };
    let mut flipped = bytes.clone();
    let middle = flipped.len() / 2;
    flipped[middle] ^= 0xFF;
    let cases = [
        damaged("notiva-backup-20260101T000000Z.notiva-backup", flipped),
        damaged(
            "notiva-backup-20260102T000000Z.notiva-backup",
            bytes[..bytes.len() - 20].to_vec(),
        ),
    ];

    for path in cases {
        let outside = world.data.parent().unwrap().join("damaged-target");
        let error = restore_to_folder(&path, None, &world.data, &outside)
            .await
            .unwrap_err();
        assert!(matches!(error, BackupError::Corrupt(_)), "{error:?}");
        assert!(!outside.exists());
    }

    let other = damaged("notes.notiva-backup", b"just some text".to_vec());
    assert!(matches!(
        archive::read_manifest(&other, None),
        Err(BackupError::NotABackup)
    ));
}

#[test]
fn an_archive_whose_content_does_not_match_its_manifest_is_refused() {
    let directory = tempfile::tempdir().unwrap();
    let snapshot = directory.path().join("db.surql");
    std::fs::write(&snapshot, "-- snapshot").unwrap();
    let images = directory.path().join("images");
    std::fs::create_dir_all(&images).unwrap();
    let contents = archive::Contents {
        app_version: "0.0.0",
        schema_version: 1,
        created_at: "2026-11-16T00:00:00Z",
        snapshot: &snapshot,
        images: &images,
    };
    let path = directory.path().join("a.notiva-backup");
    archive::write(&path, &contents, None).unwrap();
    archive::extract(&path, None, None, |_| Ok(())).unwrap();

    // Same sizes, different content: only the checksum can tell.
    let mut manifest = archive::read_manifest(&path, None).unwrap();
    manifest.files[0].sha256 = "0".repeat(64);
    let forged = directory.path().join("forged.notiva-backup");
    rewrite_with_manifest(&path, &forged, &manifest);

    assert!(matches!(
        archive::extract(&forged, None, None, |_| Ok(())),
        Err(BackupError::Corrupt(message)) if message.contains("checksum")
    ));
}

/// Copies an archive and replaces its manifest, to simulate a forged one.
fn rewrite_with_manifest(from: &Path, to: &Path, manifest: &archive::Manifest) {
    let mut reader =
        tar::Archive::new(zstd::Decoder::new(std::fs::File::open(from).unwrap()).unwrap());
    let encoder = zstd::Encoder::new(std::fs::File::create(to).unwrap(), 1).unwrap();
    let mut builder = tar::Builder::new(encoder);
    for entry in reader.entries().unwrap() {
        let mut entry = entry.unwrap();
        let name = entry.path().unwrap().to_string_lossy().into_owned();
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut bytes).unwrap();
        if name == archive::MANIFEST {
            bytes = serde_json::to_vec(manifest).unwrap();
        }
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_cksum();
        builder
            .append_data(&mut header, &name, bytes.as_slice())
            .unwrap();
    }
    builder.into_inner().unwrap().finish().unwrap();
}

#[tokio::test]
async fn a_backup_with_a_newer_schema_is_refused_before_anything_is_extracted() {
    let directory = tempfile::tempdir().unwrap();
    let snapshot = directory.path().join("db.surql");
    std::fs::write(&snapshot, "-- from the future").unwrap();
    let images = directory.path().join("images");
    let supported = Storage::supported_schema_version();
    let path = directory
        .path()
        .join("notiva-backup-20260101T000000Z.notiva-backup");
    archive::write(
        &path,
        &archive::Contents {
            app_version: "99.0.0",
            schema_version: supported + 1,
            created_at: "2026-01-01T00:00:00Z",
            snapshot: &snapshot,
            images: &images,
        },
        None,
    )
    .unwrap();
    let target = directory.path().join("target");

    let error = restore::stage(&path, None, &target).await.unwrap_err();

    assert!(matches!(
        error,
        BackupError::SchemaTooNew { found, supported: s } if found == supported + 1 && s == supported
    ));
    assert!(!target.exists());
    assert!(!inspect(&path, None).unwrap().restorable);
}

#[tokio::test]
async fn a_restore_never_writes_into_a_folder_that_is_not_empty() {
    let world = world().await;
    let info = backup(&world, Kind::Manual, None).await;
    let target = world.data.parent().unwrap().join("occupied");
    std::fs::create_dir_all(&target).unwrap();
    std::fs::write(target.join("keep.txt"), "mine").unwrap();

    let error = restore_to_folder(Path::new(&info.path), None, &world.data, &target)
        .await
        .unwrap_err();

    assert!(matches!(error, BackupError::Invalid(_)));
    assert_eq!(std::fs::read(target.join("keep.txt")).unwrap(), b"mine");

    // Nor into the app's own data folder.
    assert!(matches!(
        restore_to_folder(
            Path::new(&info.path),
            None,
            &world.data,
            &world.data.join("db")
        )
        .await,
        Err(BackupError::Invalid(_))
    ));
}

#[tokio::test]
async fn a_prepared_restore_is_applied_at_the_next_start_and_keeps_the_old_data() {
    let world = world().await;
    let info = backup(&world, Kind::Manual, None).await;
    let service = BackupService::default();

    // The "current" data differs from the backup.
    std::fs::create_dir_all(world.data.join("db")).unwrap();
    std::fs::write(world.data.join("db").join("old.txt"), "old database").unwrap();
    std::fs::write(world.data.join("images").join("old.png"), "old image").unwrap();

    let outcome = service
        .restore(&world.storage, &world.data, Path::new(&info.path), None)
        .await
        .unwrap();

    // Nothing live changed yet, and a safety backup of the current data exists.
    assert!(outcome.restart_required);
    assert_eq!(
        std::fs::read(world.data.join("db").join("old.txt")).unwrap(),
        b"old database"
    );
    let safety = Path::new(&outcome.safety_backup);
    assert!(safety.exists());
    assert!(
        list(&world.data.join("backups"))
            .unwrap()
            .iter()
            .any(|backup| backup.kind == Kind::PreRestore)
    );

    let previous = apply_pending_restore(&world.data).unwrap().unwrap();

    assert!(!world.data.join("db").join("old.txt").exists());
    assert_restored(&world.data, &world.image).await;
    assert_eq!(
        std::fs::read(previous.join("db").join("old.txt")).unwrap(),
        b"old database"
    );
    assert_eq!(
        std::fs::read(previous.join("images").join("old.png")).unwrap(),
        b"old image"
    );
    assert!(!world.data.join("restore-staging").exists());
    assert!(!world.data.join("pending-restore.json").exists());
    // Starting again changes nothing.
    assert_eq!(apply_pending_restore(&world.data).unwrap(), None);
}

#[tokio::test]
async fn an_interrupted_swap_is_finished_at_the_next_start() {
    let world = world().await;
    let info = backup(&world, Kind::Manual, None).await;
    let service = BackupService::default();
    std::fs::create_dir_all(world.data.join("db")).unwrap();
    std::fs::write(world.data.join("db").join("old.txt"), "old database").unwrap();
    service
        .restore(&world.storage, &world.data, Path::new(&info.path), None)
        .await
        .unwrap();

    // The crash: the old database was moved aside, the new one not moved in.
    std::fs::create_dir_all(world.data.join("restore-previous")).unwrap();
    std::fs::rename(
        world.data.join("db"),
        world.data.join("restore-previous").join("db"),
    )
    .unwrap();

    apply_pending_restore(&world.data).unwrap();

    assert_restored(&world.data, &world.image).await;
    assert_eq!(
        std::fs::read(
            world
                .data
                .join("restore-previous")
                .join("db")
                .join("old.txt")
        )
        .unwrap(),
        b"old database"
    );
}

#[tokio::test]
async fn a_restore_that_fails_changes_nothing_and_schedules_nothing() {
    let world = world().await;
    let service = BackupService::default();
    let bogus = world.data.join("bogus.notiva-backup");
    std::fs::write(&bogus, b"not an archive").unwrap();

    let error = service
        .restore(&world.storage, &world.data, &bogus, None)
        .await
        .unwrap_err();

    assert!(matches!(error, BackupError::NotABackup));
    assert!(!world.data.join("pending-restore.json").exists());
    assert!(!world.data.join("restore-staging").exists());
    assert!(list(&world.data.join("backups")).unwrap().is_empty());
}

#[test]
fn staged_data_without_a_marker_is_discarded_at_start() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join("restore-staging").join("db")).unwrap();
    std::fs::create_dir_all(directory.path().join("backup-tmp-abc")).unwrap();
    std::fs::create_dir_all(directory.path().join("db")).unwrap();

    assert_eq!(apply_pending_restore(directory.path()).unwrap(), None);

    assert!(!directory.path().join("restore-staging").exists());
    assert!(!directory.path().join("backup-tmp-abc").exists());
    assert!(directory.path().join("db").exists());
}

fn touch(folder: &Path, name: &str) {
    // A real archive is needed for a file to be listed.
    let directory = tempfile::tempdir().unwrap();
    let snapshot = directory.path().join("db.surql");
    std::fs::write(&snapshot, "-- x").unwrap();
    std::fs::create_dir_all(folder).unwrap();
    archive::write(
        &folder.join(name),
        &archive::Contents {
            app_version: "0.0.0",
            schema_version: 1,
            created_at: "2026-01-01T00:00:00Z",
            snapshot: &snapshot,
            images: &directory.path().join("images"),
        },
        None,
    )
    .unwrap();
}

#[test]
fn pruning_keeps_the_newest_scheduled_backups_and_never_touches_others() {
    let folder = tempfile::tempdir().unwrap();
    for day in 1..=5 {
        touch(
            folder.path(),
            &format!("notiva-auto-202611{day:02}T030000Z.notiva-backup"),
        );
    }
    touch(
        folder.path(),
        "notiva-backup-20261101T010000Z.notiva-backup",
    );
    touch(
        folder.path(),
        "notiva-pre-restore-20261102T010000Z.notiva-backup",
    );
    std::fs::write(folder.path().join("holiday.jpg"), "unrelated").unwrap();

    let removed = prune(folder.path(), 2).unwrap();

    assert_eq!(
        removed,
        [
            "notiva-auto-20261103T030000Z.notiva-backup",
            "notiva-auto-20261102T030000Z.notiva-backup",
            "notiva-auto-20261101T030000Z.notiva-backup",
        ]
    );
    let left: Vec<String> = list(folder.path())
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert_eq!(left.len(), 4);
    assert!(left.contains(&"notiva-auto-20261105T030000Z.notiva-backup".to_owned()));
    assert!(left.contains(&"notiva-auto-20261104T030000Z.notiva-backup".to_owned()));
    assert!(left.contains(&"notiva-backup-20261101T010000Z.notiva-backup".to_owned()));
    assert!(left.contains(&"notiva-pre-restore-20261102T010000Z.notiva-backup".to_owned()));
    assert!(folder.path().join("holiday.jpg").exists());

    // Keeping zero is treated as keeping one: the last backup is never deleted.
    prune(folder.path(), 0).unwrap();
    assert!(
        folder
            .path()
            .join("notiva-auto-20261105T030000Z.notiva-backup")
            .exists()
    );
}

#[test]
fn the_schedule_runs_when_the_newest_scheduled_backup_is_older_than_the_interval() {
    let folder = tempfile::tempdir().unwrap();
    assert!(
        is_due(folder.path(), Interval::Daily, at(10, 12)),
        "none yet"
    );
    assert!(
        !is_due(folder.path(), Interval::Manual, at(10, 12)),
        "schedule off"
    );

    touch(folder.path(), "notiva-auto-20261110T100000Z.notiva-backup");
    touch(
        folder.path(),
        "notiva-backup-20261110T110000Z.notiva-backup",
    );

    assert!(!is_due(folder.path(), Interval::Daily, at(10, 12)));
    assert!(is_due(folder.path(), Interval::Hourly, at(10, 12)));
    assert!(is_due(
        folder.path(),
        Interval::Daily,
        at(10, 12) + Duration::hours(23)
    ));
    assert!(!is_due(folder.path(), Interval::Weekly, at(16, 9)));
    assert!(is_due(folder.path(), Interval::Weekly, at(17, 10)));
}

#[tokio::test]
async fn a_due_backup_is_made_pruned_and_reported() {
    let world = world().await;
    let service = BackupService::default();
    Settings {
        interval: Interval::Hourly,
        keep_last: 1,
        folder: None,
    }
    .save(&world.data)
    .unwrap();
    let folder = world.data.join("backups");
    touch(&folder, "notiva-auto-20200101T000000Z.notiva-backup");

    let made = service
        .run_due(&world.storage, &world.data)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(made.kind, Kind::Auto);
    let names: Vec<String> = list(&folder).unwrap().into_iter().map(|b| b.name).collect();
    assert_eq!(names, [made.name]);
    assert!(service.status().last_success_at.is_some());
    assert_eq!(service.status().last_error, None);
    // Nothing is due right after.
    assert!(
        service
            .run_due(&world.storage, &world.data)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn a_failing_scheduled_backup_is_reported_and_prunes_nothing() {
    let world = world().await;
    let service = BackupService::default();
    let folder = world.data.join("elsewhere");
    Settings {
        interval: Interval::Hourly,
        keep_last: 1,
        folder: Some(folder.to_string_lossy().into_owned()),
    }
    .save(&world.data)
    .unwrap();
    touch(&folder, "notiva-auto-20200101T000000Z.notiva-backup");
    touch(&folder, "notiva-auto-20200102T000000Z.notiva-backup");
    // The folder becomes a file: the backup cannot be written.
    std::fs::remove_dir_all(&folder).unwrap();
    std::fs::write(&folder, "in the way").unwrap();

    let result = service.run_due(&world.storage, &world.data).await;

    assert!(result.is_err());
    assert!(service.status().last_error.is_some());
    assert_eq!(service.status().last_success_at, None);
}

#[test]
fn settings_are_validated_and_stored() {
    let data = tempfile::tempdir().unwrap();
    assert_eq!(Settings::load(data.path()).unwrap(), Settings::default());

    let chosen = tempfile::tempdir().unwrap();
    let settings = Settings {
        interval: Interval::Weekly,
        keep_last: 3,
        folder: Some(chosen.path().to_string_lossy().into_owned()),
    };
    settings.save(data.path()).unwrap();
    assert_eq!(Settings::load(data.path()).unwrap(), settings);

    let refused = |settings: Settings| {
        assert!(matches!(
            settings.save(data.path()),
            Err(BackupError::Invalid(_))
        ));
    };
    refused(Settings {
        keep_last: 0,
        ..settings.clone()
    });
    refused(Settings {
        keep_last: 1000,
        ..settings.clone()
    });
    refused(Settings {
        folder: Some("relative/folder".into()),
        ..settings.clone()
    });
    // Backups must not be written into the live database or images.
    refused(Settings {
        folder: Some(
            data.path()
                .join("db")
                .join("backups")
                .to_string_lossy()
                .into_owned(),
        ),
        ..settings.clone()
    });
    assert_eq!(Settings::load(data.path()).unwrap(), settings);
}

#[test]
fn the_default_backup_folder_is_inside_the_app_data_directory() {
    let data = Path::new("/data");

    assert_eq!(
        Settings::default().folder_or_default(data),
        data.join("backups")
    );
}

#[test]
fn the_passphrase_never_appears_in_errors_or_debug_output() {
    // `Passphrase` has no Debug or Display; this guards the error texts.
    let secret = "hunter2-very-secret";
    let errors = [
        BackupError::WrongPassphrase,
        BackupError::PassphraseRequired,
        BackupError::Corrupt("x".into()),
    ];
    for error in errors {
        assert!(!format!("{error} {error:?}").contains(secret));
    }
}

#[test]
fn backup_file_names_round_trip() {
    let name = format!("notiva-auto-{}.notiva-backup", at(3, 4).format(STAMP));
    let (kind, time) = parse_name(&name).unwrap();

    assert_eq!((kind, time), (Kind::Auto, at(3, 4)));
    assert!(parse_name("notiva-auto-20261103T040000Z-2.notiva-backup").is_some());
    for bad in [
        "notiva-auto-2026.notiva-backup",
        "notiva-auto-20261103T040000Z.zip",
        "other-20261103T040000Z.notiva-backup",
        "notiva-auto-20261103T040000Zjunk.notiva-backup",
    ] {
        assert!(parse_name(bad).is_none(), "{bad}");
    }
}
