mod commands;
mod connections;
mod foundation;
mod persistence;
mod query;
mod schema;

use std::sync::Arc;

use commands::{
    bootstrap_app, cancel_mock_job, cancel_query_execution, cancel_query_result_export,
    connect_saved_connection, delete_saved_connection, disconnect_active_connection,
    get_query_result_window, get_saved_connection, list_saved_connections, list_schema_children,
    refresh_schema_scope, save_connection, search_schema_cache, start_mock_job,
    start_query_execution, start_query_result_export, test_connection,
};
use connections::{default_secret_store, ConnectionService, RuntimePostgresDriver};
use foundation::{
    initialize_logging, AppPaths, AppState, DiagnosticsStore, JobRegistry, MockJobRunner,
};
use persistence::Repository;
use query::RuntimeQueryExecutionDriver;
use schema::{RuntimeSchemaIntrospectionDriver, SchemaService};
use tauri::Manager;
use tracing::info;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| -> Result<(), Box<dyn std::error::Error>> {
            let paths = AppPaths::resolve(app.handle())?;

            initialize_logging(&paths.log_file_path)?;

            let repository = Arc::new(Repository::new(paths.database_path.clone())?);
            repository.seed_phase_one()?;
            repository.purge_query_result_cache()?;

            let diagnostics = DiagnosticsStore::new();
            let connections = ConnectionService::new(
                repository.clone(),
                default_secret_store(),
                Arc::new(RuntimePostgresDriver),
            );
            let schema = SchemaService::new(
                repository.clone(),
                connections.clone(),
                diagnostics.clone(),
                Arc::new(RuntimeSchemaIntrospectionDriver),
            );
            let mock_jobs = MockJobRunner::new(
                diagnostics.clone(),
                repository.clone(),
                JobRegistry::default(),
            );
            let query = query::QueryService::new(
                repository.clone(),
                connections.clone(),
                diagnostics.clone(),
                Arc::new(RuntimeQueryExecutionDriver),
                JobRegistry::default(),
                JobRegistry::default(),
            );
            let state = AppState::new(
                paths,
                repository,
                diagnostics,
                mock_jobs,
                connections,
                schema,
                query,
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
            list_schema_children,
            refresh_schema_scope,
            search_schema_cache,
            start_query_execution,
            cancel_query_execution,
            get_query_result_window,
            start_query_result_export,
            cancel_query_result_export,
            start_mock_job,
            cancel_mock_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sparow");
}
