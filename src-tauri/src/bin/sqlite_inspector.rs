use std::{collections::HashMap, env, path::PathBuf};

use rusqlite::{params, Connection};
use serde::Serialize;

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args.next().ok_or_else(|| {
        usage("Missing subcommand. Expected one of: history, saved-queries, schema-cache.")
    })?;
    let options = parse_options(args.collect())?;

    let output = match command.as_str() {
        "history" => inspect_history(&options)?,
        "saved-queries" => inspect_saved_queries(&options)?,
        "schema-cache" => inspect_schema_cache(&options)?,
        other => return Err(usage(&format!(
            "Unknown subcommand '{other}'. Expected one of: history, saved-queries, schema-cache."
        ))),
    };

    let json = serde_json::to_string_pretty(&output)
        .map_err(|error| format!("Failed to serialize inspector output: {error}"))?;
    println!("{json}");
    Ok(())
}

fn inspect_history(options: &HashMap<String, String>) -> Result<InspectorOutput, String> {
    let db = required_option(options, "db")?;
    let connection_id = optional_option(options, "connection");
    let limit = parse_limit(options, 20)?;
    let connection = open_database(&db)?;

    let rows = if let Some(connection_id) = connection_id.as_deref() {
        let mut statement = connection
            .prepare(
                "select id, sql, connection_profile_id, created_at
                 from query_history
                 where connection_profile_id = ?1
                 order by created_at desc, id desc
                 limit ?2",
            )
            .map_err(|error| format!("Failed to prepare history query: {error}"))?;
        let mapped = statement
            .query_map(params![connection_id, limit], |row| {
                Ok(HistoryRow {
                    id: row.get(0)?,
                    sql: row.get(1)?,
                    connection_profile_id: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })
            .map_err(|error| format!("Failed to read query history: {error}"))?;
        collect_rows(mapped)?
    } else {
        let mut statement = connection
            .prepare(
                "select id, sql, connection_profile_id, created_at
                 from query_history
                 order by created_at desc, id desc
                 limit ?1",
            )
            .map_err(|error| format!("Failed to prepare history query: {error}"))?;
        let mapped = statement
            .query_map(params![limit], |row| {
                Ok(HistoryRow {
                    id: row.get(0)?,
                    sql: row.get(1)?,
                    connection_profile_id: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })
            .map_err(|error| format!("Failed to read query history: {error}"))?;
        collect_rows(mapped)?
    };

    Ok(InspectorOutput::History(HistoryInspection {
        db_path: db,
        connection_id,
        limit,
        rows,
    }))
}

fn inspect_saved_queries(options: &HashMap<String, String>) -> Result<InspectorOutput, String> {
    let db = required_option(options, "db")?;
    let connection_id = optional_option(options, "connection");
    let limit = parse_limit(options, 20)?;
    let search_query = optional_option(options, "search");
    let normalized_search = search_query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{}%", value.to_lowercase()));
    let connection = open_database(&db)?;

    let sql = "select id, title, sql, tags_json, connection_profile_id, created_at, updated_at
               from saved_queries
               where (?1 is null or connection_profile_id = ?1)
                 and (?2 is null
                   or lower(title) like ?2
                   or lower(sql) like ?2
                   or lower(tags_json) like ?2)
               order by updated_at desc, id desc
               limit ?3";

    let mut statement = connection
        .prepare(sql)
        .map_err(|error| format!("Failed to prepare saved-query query: {error}"))?;
    let mapped = statement
        .query_map(
            params![
                connection_id.as_deref(),
                normalized_search.as_deref(),
                limit
            ],
            |row| {
                let tags_json: String = row.get(3)?;
                let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();
                Ok(SavedQueryRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    sql: row.get(2)?,
                    tags,
                    connection_profile_id: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(|error| format!("Failed to read saved queries: {error}"))?;

    Ok(InspectorOutput::SavedQueries(SavedQueriesInspection {
        db_path: db,
        connection_id,
        limit,
        search_query,
        rows: collect_rows(mapped)?,
    }))
}

fn inspect_schema_cache(options: &HashMap<String, String>) -> Result<InspectorOutput, String> {
    let db = required_option(options, "db")?;
    let connection_id = required_option(options, "connection")?;
    let scope_path = optional_option(options, "scope");
    let normalized_scope = scope_path.as_deref().unwrap_or_default();
    let connection = open_database(&db)?;

    let mut scope_statement = connection
        .prepare(
            "select scope_path, scope_kind, refreshed_at, refresh_status
             from schema_cache_scopes
             where connection_profile_id = ?1
             order by scope_path asc",
        )
        .map_err(|error| format!("Failed to prepare schema scope query: {error}"))?;
    let scopes = collect_rows(
        scope_statement
            .query_map(params![&connection_id], |row| {
                Ok(SchemaScopeRow {
                    scope_path: empty_string_to_none(row.get::<_, String>(0)?),
                    scope_kind: row.get(1)?,
                    refreshed_at: row.get(2)?,
                    refresh_status: row.get(3)?,
                })
            })
            .map_err(|error| format!("Failed to read schema scopes: {error}"))?,
    )?;

    let mut node_statement = connection
        .prepare(
            "select object_kind, object_path, display_name, parent_path, schema_name, relation_name, position, has_children, refreshed_at
             from schema_cache
             where connection_profile_id = ?1
               and coalesce(parent_path, '') = ?2
             order by position asc, lower(display_name) asc, id asc",
        )
        .map_err(|error| format!("Failed to prepare schema node query: {error}"))?;
    let nodes = collect_rows(
        node_statement
            .query_map(params![&connection_id, normalized_scope], |row| {
                Ok(SchemaNodeRow {
                    object_kind: row.get(0)?,
                    object_path: row.get(1)?,
                    display_name: row.get(2)?,
                    parent_path: row.get(3)?,
                    schema_name: row.get(4)?,
                    relation_name: row.get(5)?,
                    position: row.get(6)?,
                    has_children: row.get(7)?,
                    refreshed_at: row.get(8)?,
                })
            })
            .map_err(|error| format!("Failed to read schema nodes: {error}"))?,
    )?;

    Ok(InspectorOutput::SchemaCache(SchemaCacheInspection {
        db_path: db,
        connection_id,
        scope_path: empty_string_to_none(normalized_scope.to_string()),
        scopes,
        nodes,
    }))
}

fn parse_options(arguments: Vec<String>) -> Result<HashMap<String, String>, String> {
    let mut options = HashMap::new();
    let mut index = 0;

    while index < arguments.len() {
        let flag = arguments[index]
            .strip_prefix("--")
            .ok_or_else(|| usage("Inspector options must use --flag <value> pairs."))?;
        let value = arguments
            .get(index + 1)
            .ok_or_else(|| usage(&format!("Missing value for --{flag}.")))?;
        options.insert(flag.to_string(), value.to_string());
        index += 2;
    }

    Ok(options)
}

fn required_option(options: &HashMap<String, String>, key: &str) -> Result<String, String> {
    optional_option(options, key).ok_or_else(|| usage(&format!("Missing required --{key} option.")))
}

fn optional_option(options: &HashMap<String, String>, key: &str) -> Option<String> {
    options
        .get(key)
        .cloned()
        .map(|value| value.trim().to_string())
        .and_then(|value| if value.is_empty() { None } else { Some(value) })
}

fn parse_limit(options: &HashMap<String, String>, default_limit: i64) -> Result<i64, String> {
    match optional_option(options, "limit") {
        Some(value) => value
            .parse::<i64>()
            .map_err(|error| format!("Invalid --limit value '{value}': {error}")),
        None => Ok(default_limit),
    }
}

fn open_database(path: &str) -> Result<Connection, String> {
    Connection::open(PathBuf::from(path))
        .map_err(|error| format!("Failed to open SQLite database '{path}': {error}"))
}

fn collect_rows<T>(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>>,
) -> Result<Vec<T>, String> {
    let mut collected = Vec::new();
    for row in rows {
        collected.push(row.map_err(|error| format!("Failed to decode inspector row: {error}"))?);
    }
    Ok(collected)
}

fn empty_string_to_none(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn usage(message: &str) -> String {
    format!(
        "{message}\n\nUsage:\n  cargo run --manifest-path src-tauri/Cargo.toml --bin sqlite_inspector -- history --db <sqlite-path> [--connection <connection-id>] [--limit <n>]\n  cargo run --manifest-path src-tauri/Cargo.toml --bin sqlite_inspector -- saved-queries --db <sqlite-path> [--connection <connection-id>] [--search <query>] [--limit <n>]\n  cargo run --manifest-path src-tauri/Cargo.toml --bin sqlite_inspector -- schema-cache --db <sqlite-path> --connection <connection-id> [--scope <scope-path>]"
    )
}

#[derive(Serialize)]
#[serde(untagged)]
enum InspectorOutput {
    History(HistoryInspection),
    SavedQueries(SavedQueriesInspection),
    SchemaCache(SchemaCacheInspection),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryInspection {
    db_path: String,
    connection_id: Option<String>,
    limit: i64,
    rows: Vec<HistoryRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedQueriesInspection {
    db_path: String,
    connection_id: Option<String>,
    search_query: Option<String>,
    limit: i64,
    rows: Vec<SavedQueryRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SchemaCacheInspection {
    db_path: String,
    connection_id: String,
    scope_path: Option<String>,
    scopes: Vec<SchemaScopeRow>,
    nodes: Vec<SchemaNodeRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryRow {
    id: String,
    sql: String,
    connection_profile_id: Option<String>,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedQueryRow {
    id: String,
    title: String,
    sql: String,
    tags: Vec<String>,
    connection_profile_id: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SchemaScopeRow {
    scope_path: Option<String>,
    scope_kind: String,
    refreshed_at: Option<String>,
    refresh_status: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SchemaNodeRow {
    object_kind: String,
    object_path: String,
    display_name: String,
    parent_path: Option<String>,
    schema_name: String,
    relation_name: Option<String>,
    position: i64,
    has_children: bool,
    refreshed_at: String,
}
