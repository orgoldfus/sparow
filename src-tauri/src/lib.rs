mod commands;
mod connections;
mod foundation;
mod persistence;
mod productivity;
mod query;
mod schema;

use std::sync::Arc;

use commands::{
    bootstrap_app, cancel_mock_job, cancel_query_execution, cancel_query_result_export,
    connect_saved_connection, delete_saved_connection, delete_saved_query,
    disconnect_active_connection, get_query_result_count, get_query_result_window,
    get_saved_connection, list_query_history, list_saved_connections, list_saved_queries,
    list_schema_children, refresh_schema_scope, save_connection, save_saved_query,
    search_schema_cache, start_mock_job, start_query_execution, start_query_result_export,
    test_connection,
};
use connections::{default_secret_store, ConnectionService, RuntimePostgresDriver};
use foundation::{
    initialize_logging, AppPaths, AppServices, AppState, DiagnosticsStore, JobRegistry,
    MockJobRunner,
};
use persistence::Repository;
use productivity::ProductivityService;
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
            let productivity = ProductivityService::new(repository.clone(), diagnostics.clone());
            let state = AppState::new(
                paths,
                repository,
                diagnostics,
                mock_jobs,
                AppServices {
                    connections,
                    schema,
                    query,
                    productivity,
                },
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
            list_query_history,
            list_saved_queries,
            save_saved_query,
            delete_saved_query,
            list_schema_children,
            refresh_schema_scope,
            search_schema_cache,
            start_query_execution,
            cancel_query_execution,
            get_query_result_window,
            get_query_result_count,
            start_query_result_export,
            cancel_query_result_export,
            start_mock_job,
            cancel_mock_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sparow");
}
