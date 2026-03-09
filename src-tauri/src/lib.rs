mod commands;
mod foundation;
mod persistence;

use std::sync::Arc;

use commands::{bootstrap_app, cancel_mock_job, start_mock_job};
use foundation::{initialize_logging, AppPaths, AppState, DiagnosticsStore, JobRegistry};
use persistence::Repository;
use tauri::Manager;
use tracing::info;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| -> Result<(), Box<dyn std::error::Error>> {
            let paths = AppPaths::resolve(&app.handle())?;

            initialize_logging(&paths.log_file_path)?;

            let repository = Arc::new(Repository::new(paths.database_path.clone())?);

            repository.seed_phase_one()?;

            let diagnostics = DiagnosticsStore::new();
            let state = AppState::new(paths, repository, diagnostics, JobRegistry::default());

            info!("application state initialized");
            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap_app,
            start_mock_job,
            cancel_mock_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sparow");
}
