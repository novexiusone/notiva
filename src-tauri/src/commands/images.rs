use tauri::State;
use tauri::ipc::{InvokeBody, Request};

use super::error::CommandError;
use crate::media::ImageStore;

/// Stores an image and returns the URL to put into the image block. The file
/// arrives as the raw body of the request, not as JSON.
#[tauri::command]
pub fn save_image(
    images: State<'_, ImageStore>,
    request: Request<'_>,
) -> Result<String, CommandError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError {
            kind: "invalid",
            message: "the image has to be sent as raw bytes".into(),
        });
    };

    Ok(images.save(bytes)?)
}
