use std::{cmp::Ordering, collections::HashMap, sync::Arc};

use tokio::sync::Mutex;

use crate::foundation::{
    QueryResultCell, QueryResultColumn, QueryResultColumnSemanticType, QueryResultFilter,
    QueryResultSetSummary, QueryResultSort, QueryResultSortDirection, QueryResultStatus,
    QueryResultWindow, QueryResultWindowRequest,
};

#[derive(Debug, Clone)]
pub(crate) struct ReplayableQueryResultHandle {
    pub result_set_id: String,
    pub tab_id: String,
    pub connection_id: String,
    pub sql: String,
    pub columns: Vec<QueryResultColumn>,
    pub initial_total_row_count: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct BufferedQueryResultHandle {
    pub result_set_id: String,
    pub tab_id: String,
    pub columns: Vec<QueryResultColumn>,
    pub rows: Vec<Vec<QueryResultCell>>,
}

#[derive(Debug, Clone)]
pub(crate) enum QueryResultHandle {
    Replayable(ReplayableQueryResultHandle),
    Buffered(BufferedQueryResultHandle),
}

impl QueryResultHandle {
    pub(crate) fn result_set_id(&self) -> &str {
        match self {
            Self::Replayable(handle) => &handle.result_set_id,
            Self::Buffered(handle) => &handle.result_set_id,
        }
    }

    pub(crate) fn tab_id(&self) -> &str {
        match self {
            Self::Replayable(handle) => &handle.tab_id,
            Self::Buffered(handle) => &handle.tab_id,
        }
    }

    pub(crate) fn columns(&self) -> &[QueryResultColumn] {
        match self {
            Self::Replayable(handle) => &handle.columns,
            Self::Buffered(handle) => &handle.columns,
        }
    }

    pub(crate) fn summary(&self) -> QueryResultSetSummary {
        match self {
            Self::Replayable(handle) => QueryResultSetSummary {
                result_set_id: handle.result_set_id.clone(),
                columns: handle.columns.clone(),
                buffered_row_count: handle.initial_total_row_count,
                total_row_count: Some(handle.initial_total_row_count),
                status: QueryResultStatus::Completed,
            },
            Self::Buffered(handle) => {
                let row_count = handle.rows.len();
                QueryResultSetSummary {
                    result_set_id: handle.result_set_id.clone(),
                    columns: handle.columns.clone(),
                    buffered_row_count: row_count,
                    total_row_count: Some(row_count),
                    status: QueryResultStatus::Completed,
                }
            }
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct QueryResultStore {
    handles: Arc<Mutex<HashMap<String, Arc<QueryResultHandle>>>>,
}

impl QueryResultStore {
    pub(crate) async fn insert(&self, handle: QueryResultHandle) -> Arc<QueryResultHandle> {
        let handle = Arc::new(handle);
        self.handles
            .lock()
            .await
            .insert(handle.result_set_id().to_string(), handle.clone());
        handle
    }

    pub(crate) async fn load(&self, result_set_id: &str) -> Option<Arc<QueryResultHandle>> {
        self.handles.lock().await.get(result_set_id).cloned()
    }

    pub(crate) async fn clear_tab_except(&self, tab_id: &str, preserved_result_set_ids: &[String]) {
        let mut handles = self.handles.lock().await;
        handles.retain(|result_set_id, handle| {
            handle.tab_id() != tab_id
                || preserved_result_set_ids
                    .iter()
                    .any(|value| value == result_set_id)
        });
    }
}

impl BufferedQueryResultHandle {
    pub(crate) fn load_window(&self, request: &QueryResultWindowRequest) -> QueryResultWindow {
        let total_row_count = self.rows.len();
        let filtered_indexes = matching_row_indexes(
            &self.rows,
            &self.columns,
            &request.quick_filter,
            &request.filters,
        );
        let mut visible_indexes = filtered_indexes;
        sort_row_indexes(
            &mut visible_indexes,
            &self.rows,
            &self.columns,
            request.sort.as_ref(),
        );

        let rows = visible_indexes
            .iter()
            .skip(request.offset)
            .take(request.limit)
            .map(|index| self.rows[*index].clone())
            .collect();

        QueryResultWindow {
            result_set_id: self.result_set_id.clone(),
            offset: request.offset,
            limit: request.limit,
            rows,
            visible_row_count: visible_indexes.len(),
            buffered_row_count: total_row_count,
            total_row_count: Some(total_row_count),
            status: QueryResultStatus::Completed,
            sort: request.sort.clone(),
            filters: request.filters.clone(),
            quick_filter: request.quick_filter.clone(),
        }
    }

    pub(crate) fn rows_for_export(
        &self,
        sort: Option<&QueryResultSort>,
        filters: &[QueryResultFilter],
        quick_filter: &str,
    ) -> Vec<&[QueryResultCell]> {
        let mut visible_indexes =
            matching_row_indexes(&self.rows, &self.columns, quick_filter, filters);
        sort_row_indexes(&mut visible_indexes, &self.rows, &self.columns, sort);

        visible_indexes
            .into_iter()
            .map(|index| self.rows[index].as_slice())
            .collect()
    }
}

fn matching_row_indexes(
    rows: &[Vec<QueryResultCell>],
    columns: &[QueryResultColumn],
    quick_filter: &str,
    filters: &[QueryResultFilter],
) -> Vec<usize> {
    let normalized_quick_filter = quick_filter.trim().to_lowercase();

    rows.iter()
        .enumerate()
        .filter_map(|(row_index, row)| {
            let matches_quick_filter = normalized_quick_filter.is_empty()
                || row.iter().any(|cell| {
                    normalized_cell_text(cell).contains(normalized_quick_filter.as_str())
                });
            if !matches_quick_filter {
                return None;
            }

            let matches_filters = filters.iter().all(|filter| {
                let Some(column) = columns.get(filter.column_index) else {
                    return false;
                };
                let Some(cell) = row.get(filter.column_index) else {
                    return false;
                };

                match filter.mode {
                    crate::foundation::QueryResultFilterMode::Contains => {
                        let needle = filter.value.trim().to_lowercase();
                        if needle.is_empty() {
                            return true;
                        }

                        let haystack = normalized_cell_text(cell);
                        let _ = column;
                        haystack.contains(needle.as_str())
                    }
                }
            });

            matches_filters.then_some(row_index)
        })
        .collect()
}

fn sort_row_indexes(
    row_indexes: &mut [usize],
    rows: &[Vec<QueryResultCell>],
    columns: &[QueryResultColumn],
    sort: Option<&QueryResultSort>,
) {
    let Some(sort) = sort else {
        return;
    };
    let Some(column) = columns.get(sort.column_index) else {
        return;
    };

    row_indexes.sort_by(|left_index, right_index| {
        let left_cell = rows[*left_index].get(sort.column_index);
        let right_cell = rows[*right_index].get(sort.column_index);
        let ordering = compare_cells(left_cell, right_cell, column.semantic_type);
        if ordering == Ordering::Equal {
            return left_index.cmp(right_index);
        }

        match sort.direction {
            QueryResultSortDirection::Asc => ordering,
            QueryResultSortDirection::Desc => ordering.reverse(),
        }
    });
}

fn compare_cells(
    left: Option<&QueryResultCell>,
    right: Option<&QueryResultCell>,
    semantic_type: QueryResultColumnSemanticType,
) -> Ordering {
    match (left, right) {
        (Some(QueryResultCell::Null) | None, Some(QueryResultCell::Null) | None) => Ordering::Equal,
        (Some(QueryResultCell::Null) | None, _) => Ordering::Greater,
        (_, Some(QueryResultCell::Null) | None) => Ordering::Less,
        (Some(left), Some(right)) => match semantic_type {
            QueryResultColumnSemanticType::Number => {
                compare_optional_values(numeric_sort_value(left), numeric_sort_value(right))
            }
            QueryResultColumnSemanticType::Boolean => {
                compare_optional_values(boolean_sort_value(left), boolean_sort_value(right))
            }
            _ => normalized_cell_text(left).cmp(&normalized_cell_text(right)),
        },
    }
}

fn compare_optional_values<T>(left: Option<T>, right: Option<T>) -> Ordering
where
    T: Ord,
{
    match (left, right) {
        (Some(left), Some(right)) => left.cmp(&right),
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
    }
}

fn numeric_sort_value(cell: &QueryResultCell) -> Option<i128> {
    match cell {
        QueryResultCell::Integer(value) => Some(i128::from(*value)),
        QueryResultCell::Float(value) if value.is_finite() => Some((*value * 1_000_000.0) as i128),
        QueryResultCell::Float(_) => None,
        QueryResultCell::String(value) => value.parse::<i128>().ok(),
        QueryResultCell::Boolean(value) => Some(i128::from(*value as i8)),
        QueryResultCell::Null => None,
    }
}

fn boolean_sort_value(cell: &QueryResultCell) -> Option<bool> {
    match cell {
        QueryResultCell::Boolean(value) => Some(*value),
        QueryResultCell::String(value) => match value.to_ascii_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        QueryResultCell::Integer(value) => Some(*value != 0),
        QueryResultCell::Float(value) => Some(*value != 0.0),
        QueryResultCell::Null => None,
    }
}

fn normalized_cell_text(cell: &QueryResultCell) -> String {
    match cell {
        QueryResultCell::String(value) => value.to_lowercase(),
        QueryResultCell::Integer(value) => value.to_string(),
        QueryResultCell::Float(value) => value.to_string(),
        QueryResultCell::Boolean(value) => value.to_string(),
        QueryResultCell::Null => String::new(),
    }
}
