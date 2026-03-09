use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use super::AppError;

pub const BACKGROUND_JOB_EVENT: &str = "foundation://job-progress";
pub const SCHEMA_REFRESH_EVENT: &str = "schema://refresh-progress";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppEnvironment {
    Development,
    Production,
    Test,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundJobStatus {
    Queued,
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SchemaNodeKind {
    Schema,
    Table,
    View,
    Column,
    Index,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SchemaScopeKind {
    Root,
    Schema,
    Table,
    View,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SchemaCacheStatus {
    Empty,
    Fresh,
    Stale,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SchemaRefreshStatus {
    Queued,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseEngine {
    Postgresql,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SecretProvider {
    OsKeychain,
    Memory,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SslMode {
    Disable,
    Prefer,
    Require,
}

impl SslMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disable => "disable",
            Self::Prefer => "prefer",
            Self::Require => "require",
        }
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "disable" => Ok(Self::Disable),
            "prefer" => Ok(Self::Prefer),
            "require" => Ok(Self::Require),
            other => Err(format!("Unsupported SSL mode '{other}'.")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSummary {
    pub id: String,
    pub engine: DatabaseEngine,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub ssl_mode: SslMode,
    pub has_stored_secret: bool,
    pub secret_provider: Option<SecretProvider>,
    pub last_tested_at: Option<String>,
    pub last_connected_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDetails {
    #[serde(flatten)]
    pub summary: ConnectionSummary,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDraft {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub ssl_mode: SslMode,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConnectionRequest {
    pub id: Option<String>,
    pub draft: ConnectionDraft,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionRequest {
    pub connection_id: Option<String>,
    pub draft: ConnectionDraft,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionTestStatus {
    Success,
    Failure,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub tested_at: String,
    pub status: ConnectionTestStatus,
    pub summary_message: String,
    pub server_version: Option<String>,
    pub current_database: Option<String>,
    pub current_user: Option<String>,
    pub ssl_in_use: Option<bool>,
    pub round_trip_ms: Option<u64>,
    pub error: Option<AppError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSessionSnapshot {
    pub connection_id: String,
    pub name: String,
    pub engine: DatabaseEngine,
    pub database: String,
    pub username: String,
    pub host: String,
    pub port: u16,
    pub connected_at: String,
    pub server_version: Option<String>,
    pub ssl_in_use: Option<bool>,
    pub status: ConnectionSessionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionSessionStatus {
    Connected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteConnectionResult {
    pub id: String,
    pub disconnected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectSessionResult {
    pub connection_id: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub sql: String,
    pub connection_profile_id: Option<String>,
    pub created_at: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub id: String,
    pub title: String,
    pub sql: String,
    pub tags: Vec<String>,
    pub updated_at: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaCacheEntry {
    pub id: String,
    pub connection_profile_id: String,
    pub object_kind: String,
    pub object_path: String,
    pub payload_json: String,
    pub refreshed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaNodeBase {
    pub id: String,
    pub connection_id: String,
    pub name: String,
    pub path: String,
    pub parent_path: Option<String>,
    pub schema_name: String,
    pub relation_name: Option<String>,
    pub has_children: bool,
    pub refreshed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum SchemaNode {
    #[serde(rename = "schema")]
    Schema {
        #[serde(flatten)]
        base: SchemaNodeBase,
    },
    #[serde(rename = "table")]
    Table {
        #[serde(flatten)]
        base: SchemaNodeBase,
    },
    #[serde(rename = "view")]
    View {
        #[serde(flatten)]
        base: SchemaNodeBase,
    },
    #[serde(rename = "column")]
    Column {
        #[serde(flatten)]
        base: SchemaNodeBase,
        data_type: String,
        is_nullable: bool,
        ordinal_position: u32,
    },
    #[serde(rename = "index")]
    Index {
        #[serde(flatten)]
        base: SchemaNodeBase,
        column_names: Vec<String>,
        is_unique: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSchemaChildrenRequest {
    pub connection_id: String,
    pub parent_kind: SchemaScopeKind,
    pub parent_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSchemaChildrenResult {
    pub connection_id: String,
    pub parent_kind: SchemaScopeKind,
    pub parent_path: Option<String>,
    pub cache_status: SchemaCacheStatus,
    pub refresh_in_flight: bool,
    pub refreshed_at: Option<String>,
    pub nodes: Vec<SchemaNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshSchemaScopeRequest {
    pub connection_id: String,
    pub scope_kind: SchemaScopeKind,
    pub scope_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRefreshAccepted {
    pub job_id: String,
    pub correlation_id: String,
    pub connection_id: String,
    pub scope_kind: SchemaScopeKind,
    pub scope_path: Option<String>,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRefreshProgressEvent {
    pub job_id: String,
    pub correlation_id: String,
    pub connection_id: String,
    pub scope_kind: SchemaScopeKind,
    pub scope_path: Option<String>,
    pub status: SchemaRefreshStatus,
    pub nodes_written: usize,
    pub message: String,
    pub timestamp: String,
    pub last_error: Option<AppError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaSearchRequest {
    pub connection_id: String,
    pub query: String,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaSearchResult {
    pub connection_id: String,
    pub query: String,
    pub nodes: Vec<SchemaNode>,
}

impl SchemaNode {
    pub fn kind(&self) -> SchemaNodeKind {
        match self {
            Self::Schema { .. } => SchemaNodeKind::Schema,
            Self::Table { .. } => SchemaNodeKind::Table,
            Self::View { .. } => SchemaNodeKind::View,
            Self::Column { .. } => SchemaNodeKind::Column,
            Self::Index { .. } => SchemaNodeKind::Index,
        }
    }

    pub fn base(&self) -> &SchemaNodeBase {
        match self {
            Self::Schema { base } => base,
            Self::Table { base } => base,
            Self::View { base } => base,
            Self::Column { base, .. } => base,
            Self::Index { base, .. } => base,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePaths {
    pub database_path: String,
    pub log_file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub last_error: Option<AppError>,
    pub recent_events: Vec<BackgroundJobProgressEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBootstrap {
    pub app_name: String,
    pub version: String,
    pub environment: AppEnvironment,
    pub platform: String,
    pub feature_flags: Vec<String>,
    pub storage: StoragePaths,
    pub diagnostics: DiagnosticsSnapshot,
    pub sample_data: SampleData,
    pub saved_connections: Vec<ConnectionSummary>,
    pub selected_connection_id: Option<String>,
    pub active_session: Option<DatabaseSessionSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleData {
    pub history_entries: usize,
    pub saved_queries: usize,
    pub schema_cache_entries: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundJobRequest {
    pub label: String,
    pub steps: u16,
    pub delay_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundJobAccepted {
    pub job_id: String,
    pub correlation_id: String,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundJobProgressEvent {
    pub job_id: String,
    pub correlation_id: String,
    pub status: BackgroundJobStatus,
    pub step: u16,
    pub total_steps: u16,
    pub message: String,
    pub timestamp: String,
    pub last_error: Option<AppError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelJobResult {
    pub job_id: String,
}

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub database_path: PathBuf,
    pub log_file_path: PathBuf,
}

impl AppPaths {
    pub fn resolve(app: &AppHandle) -> Result<Self, AppError> {
        let app_data_dir = app.path().app_data_dir().map_err(|error| {
            AppError::internal(
                "path_resolution_failed",
                "Failed to resolve app data directory.",
                Some(error.to_string()),
            )
        })?;

        let log_dir = app_data_dir.join("logs");
        std::fs::create_dir_all(&app_data_dir).map_err(|error| {
            AppError::internal(
                "path_creation_failed",
                "Failed to create app data directory.",
                Some(error.to_string()),
            )
        })?;
        std::fs::create_dir_all(&log_dir).map_err(|error| {
            AppError::internal(
                "path_creation_failed",
                "Failed to create log directory.",
                Some(error.to_string()),
            )
        })?;

        Ok(Self {
            database_path: app_data_dir.join("sparow-foundation.sqlite3"),
            log_file_path: log_dir.join("sparow.log"),
        })
    }

    pub fn as_storage_paths(&self) -> StoragePaths {
        StoragePaths {
            database_path: self.database_path.display().to_string(),
            log_file_path: self.log_file_path.display().to_string(),
        }
    }
}

pub fn iso_timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

pub fn platform_label() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

pub fn environment_label() -> AppEnvironment {
    if cfg!(test) {
        AppEnvironment::Test
    } else if cfg!(debug_assertions) {
        AppEnvironment::Development
    } else {
        AppEnvironment::Production
    }
}

pub fn ensure_parent_directory(path: &Path) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            AppError::internal(
                "path_creation_failed",
                "Failed to create a required directory.",
                Some(error.to_string()),
            )
        })?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        AppBootstrap, AppError, BackgroundJobAccepted, BackgroundJobProgressEvent,
        ConnectionDetails, ConnectionSummary, ConnectionTestResult, DatabaseSessionSnapshot,
        DeleteConnectionResult, DisconnectSessionResult, ListSchemaChildrenRequest,
        ListSchemaChildrenResult, RefreshSchemaScopeRequest, SaveConnectionRequest, SchemaNode,
        SchemaRefreshAccepted, SchemaRefreshProgressEvent, SchemaSearchRequest, SchemaSearchResult,
        TestConnectionRequest,
    };

    const APP_BOOTSTRAP_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/app-bootstrap.json");
    const APP_ERROR_FIXTURE: &str = include_str!("../../../fixtures/contracts/app-error.json");
    const BACKGROUND_JOB_ACCEPTED_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/background-job-accepted.json");
    const BACKGROUND_JOB_PROGRESS_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/background-job-progress.json");
    const CONNECTION_SUMMARY_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/connection-summary.json");
    const CONNECTION_DETAILS_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/connection-details.json");
    const SAVE_CONNECTION_REQUEST_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/save-connection-request.json");
    const TEST_CONNECTION_REQUEST_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/test-connection-request.json");
    const CONNECTION_TEST_RESULT_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/connection-test-result.json");
    const DATABASE_SESSION_SNAPSHOT_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/database-session-snapshot.json");
    const DELETE_CONNECTION_RESULT_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/delete-connection-result.json");
    const DISCONNECT_SESSION_RESULT_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/disconnect-session-result.json");
    const SCHEMA_NODE_FIXTURE: &str = include_str!("../../../fixtures/contracts/schema-node.json");
    const LIST_SCHEMA_CHILDREN_REQUEST_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/list-schema-children-request.json");
    const LIST_SCHEMA_CHILDREN_RESULT_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/list-schema-children-result.json");
    const REFRESH_SCHEMA_SCOPE_REQUEST_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/refresh-schema-scope-request.json");
    const SCHEMA_REFRESH_ACCEPTED_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/schema-refresh-accepted.json");
    const SCHEMA_REFRESH_PROGRESS_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/schema-refresh-progress.json");
    const SCHEMA_SEARCH_REQUEST_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/schema-search-request.json");
    const SCHEMA_SEARCH_RESULT_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/schema-search-result.json");

    #[test]
    fn deserializes_app_bootstrap_fixture() {
        let fixture: AppBootstrap = serde_json::from_str(APP_BOOTSTRAP_FIXTURE)
            .expect("bootstrap fixture should deserialize");
        assert_eq!(fixture.app_name, "Sparow");
        assert_eq!(fixture.saved_connections.len(), 1);
    }

    #[test]
    fn deserializes_app_error_fixture() {
        let fixture: AppError =
            serde_json::from_str(APP_ERROR_FIXTURE).expect("error fixture should deserialize");
        assert_eq!(fixture.code, "mock_job_cancelled");
    }

    #[test]
    fn deserializes_background_job_accepted_fixture() {
        let fixture: BackgroundJobAccepted = serde_json::from_str(BACKGROUND_JOB_ACCEPTED_FIXTURE)
            .expect("accepted fixture should deserialize");
        assert!(!fixture.job_id.is_empty());
    }

    #[test]
    fn deserializes_background_job_progress_fixture() {
        let fixture: BackgroundJobProgressEvent =
            serde_json::from_str(BACKGROUND_JOB_PROGRESS_FIXTURE)
                .expect("progress fixture should deserialize");
        assert_eq!(fixture.step, 2);
    }

    #[test]
    fn deserializes_connection_summary_fixture() {
        let fixture: ConnectionSummary = serde_json::from_str(CONNECTION_SUMMARY_FIXTURE)
            .expect("summary fixture should deserialize");
        assert_eq!(fixture.name, "Local Postgres");
    }

    #[test]
    fn deserializes_connection_details_fixture() {
        let fixture: ConnectionDetails = serde_json::from_str(CONNECTION_DETAILS_FIXTURE)
            .expect("details fixture should deserialize");
        assert_eq!(fixture.summary.host, "127.0.0.1");
    }

    #[test]
    fn deserializes_save_connection_request_fixture() {
        let fixture: SaveConnectionRequest = serde_json::from_str(SAVE_CONNECTION_REQUEST_FIXTURE)
            .expect("save request fixture should deserialize");
        assert_eq!(fixture.draft.database, "app_dev");
    }

    #[test]
    fn deserializes_test_connection_request_fixture() {
        let fixture: TestConnectionRequest = serde_json::from_str(TEST_CONNECTION_REQUEST_FIXTURE)
            .expect("test request fixture should deserialize");
        assert!(fixture.connection_id.is_none());
    }

    #[test]
    fn deserializes_connection_test_result_fixture() {
        let fixture: ConnectionTestResult = serde_json::from_str(CONNECTION_TEST_RESULT_FIXTURE)
            .expect("test result fixture should deserialize");
        assert_eq!(fixture.round_trip_ms, Some(42));
    }

    #[test]
    fn deserializes_database_session_snapshot_fixture() {
        let fixture: DatabaseSessionSnapshot =
            serde_json::from_str(DATABASE_SESSION_SNAPSHOT_FIXTURE)
                .expect("session fixture should deserialize");
        assert_eq!(fixture.connection_id, "conn-local-postgres");
    }

    #[test]
    fn deserializes_delete_connection_result_fixture() {
        let fixture: DeleteConnectionResult =
            serde_json::from_str(DELETE_CONNECTION_RESULT_FIXTURE)
                .expect("delete fixture should deserialize");
        assert!(fixture.disconnected);
    }

    #[test]
    fn deserializes_disconnect_session_result_fixture() {
        let fixture: DisconnectSessionResult =
            serde_json::from_str(DISCONNECT_SESSION_RESULT_FIXTURE)
                .expect("disconnect fixture should deserialize");
        assert_eq!(
            fixture.connection_id.as_deref(),
            Some("conn-local-postgres")
        );
    }

    #[test]
    fn deserializes_schema_node_fixture() {
        let fixture: SchemaNode = serde_json::from_str(SCHEMA_NODE_FIXTURE)
            .expect("schema node fixture should deserialize");
        match fixture {
            SchemaNode::Index { column_names, .. } => {
                assert_eq!(column_names, vec!["email".to_string()])
            }
            other => panic!("expected index node, got {other:?}"),
        }
    }

    #[test]
    fn deserializes_list_schema_children_request_fixture() {
        let fixture: ListSchemaChildrenRequest =
            serde_json::from_str(LIST_SCHEMA_CHILDREN_REQUEST_FIXTURE)
                .expect("list schema children request fixture should deserialize");
        assert_eq!(fixture.parent_path.as_deref(), Some("schema/public"));
    }

    #[test]
    fn deserializes_list_schema_children_result_fixture() {
        let fixture: ListSchemaChildrenResult =
            serde_json::from_str(LIST_SCHEMA_CHILDREN_RESULT_FIXTURE)
                .expect("list schema children result fixture should deserialize");
        assert_eq!(fixture.nodes.len(), 2);
    }

    #[test]
    fn deserializes_refresh_schema_scope_request_fixture() {
        let fixture: RefreshSchemaScopeRequest =
            serde_json::from_str(REFRESH_SCHEMA_SCOPE_REQUEST_FIXTURE)
                .expect("refresh schema scope request fixture should deserialize");
        assert_eq!(fixture.scope_path.as_deref(), Some("schema/public"));
    }

    #[test]
    fn deserializes_schema_refresh_accepted_fixture() {
        let fixture: SchemaRefreshAccepted = serde_json::from_str(SCHEMA_REFRESH_ACCEPTED_FIXTURE)
            .expect("schema refresh accepted fixture should deserialize");
        assert_eq!(fixture.job_id, "schema-job-2026");
    }

    #[test]
    fn deserializes_schema_refresh_progress_fixture() {
        let fixture: SchemaRefreshProgressEvent =
            serde_json::from_str(SCHEMA_REFRESH_PROGRESS_FIXTURE)
                .expect("schema refresh progress fixture should deserialize");
        assert_eq!(fixture.nodes_written, 2);
    }

    #[test]
    fn deserializes_schema_search_request_fixture() {
        let fixture: SchemaSearchRequest = serde_json::from_str(SCHEMA_SEARCH_REQUEST_FIXTURE)
            .expect("schema search request fixture should deserialize");
        assert_eq!(fixture.limit, 8);
    }

    #[test]
    fn deserializes_schema_search_result_fixture() {
        let fixture: SchemaSearchResult = serde_json::from_str(SCHEMA_SEARCH_RESULT_FIXTURE)
            .expect("schema search result fixture should deserialize");
        assert_eq!(fixture.nodes.len(), 2);
    }
}
