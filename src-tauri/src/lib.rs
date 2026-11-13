mod commands;
mod domain;
mod media;
mod storage;

use tauri::Manager;

use media::ImageStore;
use storage::Storage;

/// SurrealDB recurses deeply while parsing and planning queries, which
/// overflows tokio's default 2 MiB worker stacks in unoptimised builds.
const WORKER_STACK_SIZE: usize = 16 * 1024 * 1024;

pub fn run() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(WORKER_STACK_SIZE)
        .build()
        .expect("error while starting the async runtime");
    tauri::async_runtime::set(runtime.handle().clone());

    tauri::Builder::default()
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let storage = tauri::async_runtime::block_on(Storage::open(&data.join("db")))?;
            app.manage(storage);
            app.manage(ImageStore::open(&data.join("images"))?);
            Ok(())
        })
        // Serves stored images to the WebView, and nothing else.
        .register_uri_scheme_protocol(media::SCHEME, |context, request| {
            let name = request.uri().path().trim_start_matches('/');
            let image = context
                .app_handle()
                .try_state::<ImageStore>()
                .and_then(|images| images.read(name));

            match image {
                Some((bytes, mime)) => tauri::http::Response::builder()
                    .header("Content-Type", mime)
                    .header("Cache-Control", "private, max-age=31536000, immutable")
                    .body(bytes),
                None => tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new()),
            }
            .expect("a response with static headers is valid")
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::pages::list_pages,
            commands::pages::create_page,
            commands::pages::rename_page,
            commands::pages::move_page,
            commands::pages::delete_page,
            commands::blocks::load_blocks,
            commands::blocks::save_blocks,
            commands::images::save_image,
            commands::links::list_backlinks,
            commands::search::search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
