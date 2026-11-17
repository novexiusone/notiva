use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};

use super::error::CommandError;
use crate::backup::{
    self, BackupInfo, BackupService, BackupSummary, Kind, Passphrase, RestoreOutcome, Settings,
    Status,
};
use crate::storage::Storage;

/// The event the frontend listens to for failures of scheduled backups.
const FAILED_EVENT: &str = "backup-failed";
/// How often the scheduler looks whether a backup is due.
const TICK: Duration = Duration::from_secs(5 * 60);

fn data_dir(app: &AppHandle) -> Result<PathBuf, CommandError> {
    app.path().app_data_dir().map_err(|error| CommandError {
        kind: "internal",
        message: error.to_string(),
    })
}

/// `None` means no passphrase; an empty one is an error, never "none".
fn passphrase(text: Option<String>) -> Result<Option<Passphrase>, CommandError> {
    Ok(text.map(Passphrase::new).transpose()?)
}

#[tauri::command]
pub fn get_backup_settings(app: AppHandle) -> Result<Settings, CommandError> {
    Ok(Settings::load(&data_dir(&app)?)?)
}

#[tauri::command]
pub fn set_backup_settings(app: AppHandle, settings: Settings) -> Result<Settings, CommandError> {
    settings.save(&data_dir(&app)?)?;
    Ok(settings)
}

/// Makes a backup in the backup folder. With a passphrase it is encrypted.
#[tauri::command]
pub async fn create_backup(
    app: AppHandle,
    storage: State<'_, Storage>,
    service: State<'_, BackupService>,
    passphrase: Option<String>,
) -> Result<BackupInfo, CommandError> {
    let data = data_dir(&app)?;
    let folder = Settings::load(&data)?.folder_or_default(&data);
    let passphrase = self::passphrase(passphrase)?;

    Ok(service
        .create(&storage, &data, &folder, Kind::Manual, passphrase.as_ref())
        .await?)
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, CommandError> {
    let data = data_dir(&app)?;
    let folder = Settings::load(&data)?.folder_or_default(&data);
    Ok(backup::list(&folder)?)
}

/// What a backup file contains, without restoring it.
#[tauri::command]
pub async fn inspect_backup(
    path: String,
    passphrase: Option<String>,
) -> Result<BackupSummary, CommandError> {
    let passphrase = self::passphrase(passphrase)?;
    tokio::task::spawn_blocking(move || backup::inspect(Path::new(&path), passphrase.as_ref()))
        .await
        .map_err(|error| CommandError {
            kind: "internal",
            message: error.to_string(),
        })?
        .map_err(Into::into)
}

/// Prepares a restore. The data is replaced when the app starts the next
/// time; until then nothing live has changed.
#[tauri::command]
pub async fn restore_backup(
    app: AppHandle,
    storage: State<'_, Storage>,
    service: State<'_, BackupService>,
    path: String,
    passphrase: Option<String>,
) -> Result<RestoreOutcome, CommandError> {
    let data = data_dir(&app)?;
    let passphrase = self::passphrase(passphrase)?;

    Ok(service
        .restore(&storage, &data, Path::new(&path), passphrase.as_ref())
        .await?)
}

/// Restores into a new folder and leaves the app's data alone.
#[tauri::command]
pub async fn restore_backup_to_folder(
    app: AppHandle,
    path: String,
    passphrase: Option<String>,
    directory: String,
) -> Result<(), CommandError> {
    let data = data_dir(&app)?;
    let passphrase = self::passphrase(passphrase)?;

    Ok(backup::restore_to_folder(
        Path::new(&path),
        passphrase.as_ref(),
        &data,
        Path::new(&directory),
    )
    .await?)
}

#[tauri::command]
pub fn backup_status(service: State<'_, BackupService>) -> Status {
    service.status()
}

/// Restarts the app, which is when a prepared restore is applied.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}

/// Runs for the lifetime of the app: a scheduled backup is made at start when
/// one is due and then whenever the interval has passed. A failure is
/// remembered in the status and sent to the frontend as an event.
pub async fn run_scheduler(app: AppHandle) {
    let mut failures = 0u32;
    loop {
        match tick(&app).await {
            Ok(()) => failures = 0,
            Err(message) => {
                failures = failures.saturating_add(1);
                eprintln!("scheduled backup failed: {message}");
                let _ = app.emit(FAILED_EVENT, message);
            }
        }
        // After a failure the wait doubles up to 6 hours, so a full disk or a
        // missing drive does not cause a full export every few minutes.
        let wait = TICK
            .saturating_mul(1 << failures.min(6))
            .min(Duration::from_secs(6 * 60 * 60));
        tokio::time::sleep(if failures == 0 { TICK } else { wait }).await;
    }
}

async fn tick(app: &AppHandle) -> Result<(), String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let (Some(storage), Some(service)) =
        (app.try_state::<Storage>(), app.try_state::<BackupService>())
    else {
        return Ok(());
    };
    service
        .run_due(&storage, &data)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}
