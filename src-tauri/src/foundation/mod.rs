mod contracts;
mod error;
mod jobs;
mod logging;
mod state;

#[allow(unused_imports)]
pub use contracts::{
    ensure_parent_directory, environment_label, iso_timestamp, platform_label, AppBootstrap,
    AppPaths, BackgroundJobAccepted, BackgroundJobProgressEvent, BackgroundJobRequest,
    BackgroundJobStatus, CancelJobResult, CancelQueryExecutionResult,
    CancelQueryResultExportResult, ConnectionDetails, ConnectionDraft, ConnectionSessionStatus,
    ConnectionSummary, ConnectionTestResult, ConnectionTestStatus, DatabaseEngine,
    DatabaseSessionSnapshot, DeleteConnectionResult, DeleteSavedQueryResult, DiagnosticsSnapshot,
    DisconnectSessionResult, HistoryEntry, ListQueryHistoryRequest, ListQueryHistoryResult,
    ListSavedQueriesRequest, ListSavedQueriesResult, ListSchemaChildrenRequest,
    ListSchemaChildrenResult, QueryExecutionAccepted, QueryExecutionOrigin,
    QueryExecutionProgressEvent, QueryExecutionRequest, QueryExecutionResult, QueryExecutionStatus,
    QueryResultCell, QueryResultColumn, QueryResultColumnSemanticType, QueryResultCountRequest,
    QueryResultCountResult, QueryResultExportAccepted, QueryResultExportProgressEvent,
    QueryResultExportRequest, QueryResultExportStatus, QueryResultFilter, QueryResultFilterMode,
    QueryResultSetSummary, QueryResultSort, QueryResultSortDirection, QueryResultStatus,
    QueryResultWindow, QueryResultWindowRequest, RefreshSchemaScopeRequest, SaveConnectionRequest,
    SaveSavedQueryRequest, SavedQuery, SchemaCacheStatus, SchemaNode, SchemaNodeBase,
    SchemaNodeKind, SchemaRefreshAccepted, SchemaRefreshProgressEvent, SchemaRefreshStatus,
    SchemaScopeKind, SchemaSearchRequest, SchemaSearchResult, SecretProvider, SslMode,
    TestConnectionRequest, BACKGROUND_JOB_EVENT, QUERY_EXECUTION_EVENT, QUERY_RESULT_EXPORT_EVENT,
    SCHEMA_REFRESH_EVENT,
};
pub use error::AppError;
pub use jobs::JobRegistry;
pub(crate) use jobs::MockJobRunner;
pub use logging::initialize_logging;
pub use state::{AppState, DiagnosticsStore};
