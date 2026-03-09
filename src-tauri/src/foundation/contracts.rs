use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::AppError;

pub const BACKGROUND_JOB_EVENT: &str = "foundation://job-progress";

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

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretRef {
    pub provider: String,
    pub service: String,
    pub account: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub ssl_mode: String,
    pub secret_ref: Option<SecretRef>,
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
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| AppError::internal("path_resolution_failed", "Failed to resolve app data directory.", Some(error.to_string())))?;

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
    use std::time::{SystemTime, UNIX_EPOCH};

    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    format!("{duration}")
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
    use super::{AppBootstrap, AppError, BackgroundJobAccepted, BackgroundJobProgressEvent};

    const APP_BOOTSTRAP_FIXTURE: &str = include_str!("../../../fixtures/contracts/app-bootstrap.json");
    const APP_ERROR_FIXTURE: &str = include_str!("../../../fixtures/contracts/app-error.json");
    const BACKGROUND_JOB_ACCEPTED_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/background-job-accepted.json");
    const BACKGROUND_JOB_PROGRESS_FIXTURE: &str =
        include_str!("../../../fixtures/contracts/background-job-progress.json");

    #[test]
    fn deserializes_app_bootstrap_fixture() {
        let fixture: AppBootstrap =
            serde_json::from_str(APP_BOOTSTRAP_FIXTURE).expect("bootstrap fixture should deserialize");
        assert_eq!(fixture.app_name, "Sparow");
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
        assert_eq!(fixture.job_id, "job-2026-phase1");
    }

    #[test]
    fn deserializes_background_job_progress_fixture() {
        let fixture: BackgroundJobProgressEvent = serde_json::from_str(BACKGROUND_JOB_PROGRESS_FIXTURE)
            .expect("progress fixture should deserialize");
        assert_eq!(fixture.step, 2);
    }
}
