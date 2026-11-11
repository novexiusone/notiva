mod commands;
mod domain;
mod storage;

use tauri::Manager;

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
            let directory = app.path().app_data_dir()?.join("db");
            let storage = tauri::async_runtime::block_on(Storage::open(&directory))?;
            app.manage(storage);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::pages::list_pages,
            commands::pages::create_page,
            commands::pages::rename_page,
            commands::pages::move_page,
            commands::pages::delete_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
