mod contracts;
mod error;
mod jobs;
mod logging;
mod state;

pub use contracts::{
    AppBootstrap, AppPaths, BackgroundJobAccepted, BackgroundJobProgressEvent, BackgroundJobRequest,
    BackgroundJobStatus, CancelJobResult, DiagnosticsSnapshot, BACKGROUND_JOB_EVENT,
    ensure_parent_directory, environment_label, iso_timestamp, platform_label,
};
pub use error::AppError;
pub use jobs::JobRegistry;
pub use logging::initialize_logging;
pub use state::{AppState, DiagnosticsStore};
