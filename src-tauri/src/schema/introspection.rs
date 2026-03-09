use async_trait::async_trait;
use tokio_postgres::Row;

use crate::{
    connections::ActiveSessionRuntime,
    foundation::{AppError, SchemaNode, SchemaNodeBase, SchemaNodeKind, SchemaScopeKind},
};

use super::service::ParsedScope;

#[async_trait]
pub(crate) trait SchemaIntrospectionDriver: Send + Sync {
    async fn introspect_scope(
        &self,
        session: &ActiveSessionRuntime,
        scope: &ParsedScope,
        refreshed_at: &str,
    ) -> Result<Vec<SchemaNode>, AppError>;
}

pub(crate) struct RuntimeSchemaIntrospectionDriver;

#[async_trait]
impl SchemaIntrospectionDriver for RuntimeSchemaIntrospectionDriver {
    async fn introspect_scope(
        &self,
        session: &ActiveSessionRuntime,
        scope: &ParsedScope,
        refreshed_at: &str,
    ) -> Result<Vec<SchemaNode>, AppError> {
        let pool = session.pool.clone().ok_or_else(|| {
            AppError::internal(
                "schema_missing_active_pool",
                "Schema browsing requires an active PostgreSQL pool.",
                Some(session.snapshot.connection_id.clone()),
            )
        })?;
        let client = pool.get().await.map_err(|error| {
            AppError::retryable(
                "schema_introspection_query_failed",
                "Failed to borrow a PostgreSQL client for schema introspection.",
                Some(error.to_string()),
            )
        })?;

        match scope.kind {
            SchemaScopeKind::Root => {
                let rows = client
                    .query(
                        "select nspname
                         from pg_namespace
                         where nspname not in ('pg_catalog', 'information_schema')
                           and nspname not like 'pg_toast%'
                           and nspname not like 'pg_temp_%'
                         order by nspname",
                        &[],
                    )
                    .await
                    .map_err(schema_query_error)?;

                Ok(rows
                    .into_iter()
                    .map(|row| {
                        schema_row_to_node(&session.snapshot.connection_id, row, refreshed_at)
                    })
                    .collect())
            }
            SchemaScopeKind::Schema => {
                let schema_name = scope.schema_name.as_deref().ok_or_else(|| {
                    AppError::internal(
                        "schema_scope_parse_failed",
                        "Schema scope is missing a schema name.",
                        scope.path.clone(),
                    )
                })?;
                let rows = client
                    .query(
                        "select relname, relkind::text
                         from pg_class c
                         join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = $1
                           and c.relkind in ('r', 'p', 'v')
                         order by case when c.relkind in ('r', 'p') then 0 else 1 end, relname",
                        &[&schema_name],
                    )
                    .await
                    .map_err(schema_query_error)?;

                Ok(rows
                    .into_iter()
                    .map(|row| {
                        relation_row_to_node(
                            &session.snapshot.connection_id,
                            schema_name,
                            row,
                            refreshed_at,
                        )
                    })
                    .collect())
            }
            SchemaScopeKind::Table | SchemaScopeKind::View => {
                let schema_name = scope.schema_name.as_deref().ok_or_else(|| {
                    AppError::internal(
                        "schema_scope_parse_failed",
                        "Relation scope is missing a schema name.",
                        scope.path.clone(),
                    )
                })?;
                let relation_name = scope.relation_name.as_deref().ok_or_else(|| {
                    AppError::internal(
                        "schema_scope_parse_failed",
                        "Relation scope is missing a relation name.",
                        scope.path.clone(),
                    )
                })?;
                let relation_kind = client
                    .query_opt(
                        "select c.relkind::text
                         from pg_class c
                         join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = $1
                           and c.relname = $2",
                        &[&schema_name, &relation_name],
                    )
                    .await
                    .map_err(schema_query_error)?
                    .map(|row| row.get::<_, String>(0))
                    .ok_or_else(|| {
                        AppError::internal(
                            "schema_relation_not_found",
                            "The requested schema relation does not exist.",
                            scope.path.clone(),
                        )
                    })?;

                if !relation_kind_matches_scope(scope.kind, &relation_kind) {
                    return Err(AppError::internal(
                        "schema_scope_kind_mismatch",
                        "The requested schema scope kind does not match the PostgreSQL relation type.",
                        scope.path.clone(),
                    ));
                }

                let column_rows = client
                    .query(
                        "select attname, format_type(atttypid, atttypmod), not attnotnull as is_nullable, attnum
                         from pg_attribute a
                         join pg_class c on c.oid = a.attrelid
                         join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = $1
                           and c.relname = $2
                           and a.attnum > 0
                           and not a.attisdropped
                         order by a.attnum",
                        &[&schema_name, &relation_name],
                    )
                    .await
                    .map_err(schema_query_error)?;

                let index_rows = client
                    .query(
                        "select i.relname,
                                ix.indisunique,
                                coalesce(
                                  array_agg(a.attname order by ord.ordinality)
                                    filter (where a.attname is not null),
                                  array[]::text[]
                                ) as column_names
                         from pg_class t
                         join pg_namespace n on n.oid = t.relnamespace
                         join pg_index ix on ix.indrelid = t.oid
                         join pg_class i on i.oid = ix.indexrelid
                         left join unnest(ix.indkey) with ordinality as ord(attnum, ordinality) on true
                         left join pg_attribute a on a.attrelid = t.oid and a.attnum = ord.attnum
                         where n.nspname = $1
                           and t.relname = $2
                         group by i.relname, ix.indisunique
                         order by i.relname",
                        &[&schema_name, &relation_name],
                    )
                    .await
                    .map_err(schema_query_error)?;

                let mut nodes = Vec::with_capacity(column_rows.len() + index_rows.len());
                for row in column_rows {
                    nodes.push(column_row_to_node(
                        &session.snapshot.connection_id,
                        scope.kind,
                        schema_name,
                        relation_name,
                        row,
                        refreshed_at,
                    ));
                }
                for row in index_rows {
                    nodes.push(index_row_to_node(
                        &session.snapshot.connection_id,
                        scope.kind,
                        schema_name,
                        relation_name,
                        row,
                        refreshed_at,
                    ));
                }

                Ok(nodes)
            }
        }
    }
}

// --- Path helpers ---

pub(crate) fn schema_path(schema_name: &str) -> String {
    format!("schema/{schema_name}")
}

pub(crate) fn schema_node_id(connection_id: &str, path: &str) -> String {
    format!("{connection_id}:{path}")
}

fn relation_path(kind: SchemaNodeKind, schema_name: &str, relation_name: &str) -> String {
    format!(
        "{}/{}/{}",
        schema_kind_prefix(kind),
        schema_name,
        relation_name
    )
}

fn relation_parent_path(schema_name: &str) -> String {
    schema_path(schema_name)
}

fn relation_child_path(
    kind: SchemaNodeKind,
    schema_name: &str,
    relation_name: &str,
    name: &str,
) -> String {
    format!(
        "{}/{}/{}/{}",
        schema_kind_prefix(kind),
        schema_name,
        relation_name,
        name
    )
}

fn schema_kind_prefix(kind: SchemaNodeKind) -> &'static str {
    match kind {
        SchemaNodeKind::Schema => "schema",
        SchemaNodeKind::Table => "table",
        SchemaNodeKind::View => "view",
        SchemaNodeKind::Column => "column",
        SchemaNodeKind::Index => "index",
    }
}

fn relation_scope_path(
    scope_kind: SchemaScopeKind,
    schema_name: &str,
    relation_name: &str,
) -> String {
    let prefix = if matches!(scope_kind, SchemaScopeKind::View) {
        "view"
    } else {
        "table"
    };
    format!("{prefix}/{schema_name}/{relation_name}")
}

pub(crate) fn relation_kind_matches_scope(scope_kind: SchemaScopeKind, relkind: &str) -> bool {
    match scope_kind {
        SchemaScopeKind::Table => matches!(relkind, "r" | "p"),
        SchemaScopeKind::View => relkind == "v",
        SchemaScopeKind::Root | SchemaScopeKind::Schema => false,
    }
}

// --- Row-to-node converters ---

fn schema_query_error(error: tokio_postgres::Error) -> AppError {
    AppError::retryable(
        "schema_introspection_query_failed",
        "PostgreSQL schema introspection failed.",
        Some(error.to_string()),
    )
}

fn schema_row_to_node(connection_id: &str, row: Row, refreshed_at: &str) -> SchemaNode {
    let schema_name: String = row.get(0);
    let path = schema_path(&schema_name);
    SchemaNode::Schema {
        base: SchemaNodeBase {
            id: schema_node_id(connection_id, &path),
            connection_id: connection_id.to_string(),
            name: schema_name.clone(),
            path,
            parent_path: None,
            schema_name,
            relation_name: None,
            has_children: true,
            refreshed_at: refreshed_at.to_string(),
        },
    }
}

fn relation_row_to_node(
    connection_id: &str,
    schema_name: &str,
    row: Row,
    refreshed_at: &str,
) -> SchemaNode {
    let relation_name: String = row.get(0);
    let relkind: String = row.get(1);
    let path = relation_path(
        if relkind == "v" {
            SchemaNodeKind::View
        } else {
            SchemaNodeKind::Table
        },
        schema_name,
        &relation_name,
    );
    let base = SchemaNodeBase {
        id: schema_node_id(connection_id, &path),
        connection_id: connection_id.to_string(),
        name: relation_name.clone(),
        path,
        parent_path: Some(relation_parent_path(schema_name)),
        schema_name: schema_name.to_string(),
        relation_name: Some(relation_name.clone()),
        has_children: true,
        refreshed_at: refreshed_at.to_string(),
    };

    if relkind == "v" {
        SchemaNode::View { base }
    } else {
        SchemaNode::Table { base }
    }
}

fn column_row_to_node(
    connection_id: &str,
    scope_kind: SchemaScopeKind,
    schema_name: &str,
    relation_name: &str,
    row: Row,
    refreshed_at: &str,
) -> SchemaNode {
    let name: String = row.get(0);
    let data_type: String = row.get(1);
    let is_nullable: bool = row.get(2);
    let ordinal_position: i16 = row.get(3);
    let path = relation_child_path(SchemaNodeKind::Column, schema_name, relation_name, &name);
    SchemaNode::Column {
        base: SchemaNodeBase {
            id: schema_node_id(connection_id, &path),
            connection_id: connection_id.to_string(),
            name: name.clone(),
            path,
            parent_path: Some(relation_scope_path(scope_kind, schema_name, relation_name)),
            schema_name: schema_name.to_string(),
            relation_name: Some(relation_name.to_string()),
            has_children: false,
            refreshed_at: refreshed_at.to_string(),
        },
        data_type,
        is_nullable,
        ordinal_position: ordinal_position as u32,
    }
}

fn index_row_to_node(
    connection_id: &str,
    scope_kind: SchemaScopeKind,
    schema_name: &str,
    relation_name: &str,
    row: Row,
    refreshed_at: &str,
) -> SchemaNode {
    let name: String = row.get(0);
    let is_unique: bool = row.get(1);
    let column_names: Vec<String> = row.get(2);
    let path = relation_child_path(SchemaNodeKind::Index, schema_name, relation_name, &name);
    SchemaNode::Index {
        base: SchemaNodeBase {
            id: schema_node_id(connection_id, &path),
            connection_id: connection_id.to_string(),
            name: name.clone(),
            path,
            parent_path: Some(relation_scope_path(scope_kind, schema_name, relation_name)),
            schema_name: schema_name.to_string(),
            relation_name: Some(relation_name.to_string()),
            has_children: false,
            refreshed_at: refreshed_at.to_string(),
        },
        column_names,
        is_unique,
    }
}
