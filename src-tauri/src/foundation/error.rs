use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
    pub retryable: bool,
    pub correlation_id: String,
}

impl AppError {
    pub fn internal(code: &str, message: &str, detail: Option<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            detail,
            retryable: false,
            correlation_id: Uuid::new_v4().to_string(),
        }
    }

    pub fn retryable(code: &str, message: &str, detail: Option<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            detail,
            retryable: true,
            correlation_id: Uuid::new_v4().to_string(),
        }
    }
}
