use std::{fs::OpenOptions, path::Path};

use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use super::{ensure_parent_directory, AppError};

pub fn initialize_logging(log_path: &Path) -> Result<(), AppError> {
    ensure_parent_directory(log_path)?;

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|error| {
            AppError::internal(
                "log_file_open_failed",
                "Failed to open the structured log file.",
                Some(error.to_string()),
            )
        })?;

    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sparow=debug"));

    let stdout_layer = fmt::layer()
        .with_target(true)
        .with_ansi(true)
        .with_writer(std::io::stdout);

    let file_layer = fmt::layer()
        .with_ansi(false)
        .with_target(true)
        .with_writer(file);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(stdout_layer)
        .with(file_layer)
        .try_init()
        .map_err(|error| {
            AppError::internal(
                "log_init_failed",
                "Failed to initialize tracing subscribers.",
                Some(error.to_string()),
            )
        })
}
