mod contracts;
mod error;
mod jobs;
mod logging;
mod state;

pub use contracts::{
    ensure_parent_directory, environment_label, iso_timestamp, platform_label, AppBootstrap,
    AppPaths, BackgroundJobAccepted, BackgroundJobProgressEvent, BackgroundJobRequest,
    BackgroundJobStatus, CancelJobResult, ConnectionDetails, ConnectionDraft,
    ConnectionSessionStatus, ConnectionSummary, ConnectionTestResult, ConnectionTestStatus,
    DatabaseEngine, DatabaseSessionSnapshot, DeleteConnectionResult, DiagnosticsSnapshot,
    DisconnectSessionResult, ListSchemaChildrenRequest, ListSchemaChildrenResult,
    RefreshSchemaScopeRequest, SaveConnectionRequest, SchemaCacheStatus, SchemaNode,
    SchemaNodeBase, SchemaNodeKind, SchemaRefreshAccepted, SchemaRefreshProgressEvent,
    SchemaRefreshStatus, SchemaScopeKind, SchemaSearchRequest, SchemaSearchResult, SecretProvider,
    SslMode, TestConnectionRequest, BACKGROUND_JOB_EVENT, SCHEMA_REFRESH_EVENT,
};
pub use error::AppError;
pub use jobs::JobRegistry;
pub use logging::initialize_logging;
pub use state::{AppState, DiagnosticsStore};
