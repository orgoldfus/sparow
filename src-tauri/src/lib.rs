mod commands;
mod connections;
mod foundation;
mod persistence;

use std::sync::Arc;

use commands::{
    bootstrap_app, cancel_mock_job, connect_saved_connection, delete_saved_connection,
    disconnect_active_connection, get_saved_connection, list_saved_connections, save_connection,
    start_mock_job, test_connection,
};
use connections::{default_secret_store, ConnectionService, RuntimePostgresDriver};
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
            let connections = ConnectionService::new(
                repository.clone(),
                default_secret_store(),
                Arc::new(RuntimePostgresDriver),
            );
            let state = AppState::new(
                paths,
                repository,
                diagnostics,
                JobRegistry::default(),
                connections,
            );

            info!("application state initialized");
            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap_app,
            list_saved_connections,
            get_saved_connection,
            save_connection,
            test_connection,
            connect_saved_connection,
            disconnect_active_connection,
            delete_saved_connection,
            start_mock_job,
            cancel_mock_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sparow");
}
