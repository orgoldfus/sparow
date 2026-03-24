use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
};

use tokio::sync::Mutex as AsyncMutex;

use crate::foundation::{
    QueryResultCell, QueryResultColumn, QueryResultColumnSemanticType, QueryResultFilter,
    QueryResultSetSummary, QueryResultSort, QueryResultSortDirection, QueryResultStatus,
    QueryResultWindow, QueryResultWindowRequest,
};

#[derive(Debug)]
struct ReplayableQueryResultPage {
    rows: Vec<Vec<QueryResultCell>>,
    has_more_rows_after: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ReplayablePageRange {
    pub start: usize,
    pub end: usize,
}

impl ReplayablePageRange {
    pub(crate) fn with_margin(self, margin: usize) -> Self {
        Self {
            start: self.start.saturating_sub(margin),
            end: self.end.saturating_add(margin),
        }
    }
}

#[derive(Debug)]
struct ReplayableQueryResultCache {
    descriptor_signature: String,
    count_signature: String,
    page_size: usize,
    pages: BTreeMap<usize, ReplayableQueryResultPage>,
    total_row_count: Option<usize>,
}

#[derive(Debug, Clone)]
pub(crate) struct ReplayableQueryCacheSnapshot {
    pub descriptor_signature: String,
    pub cached_page_indexes: Vec<usize>,
}

#[derive(Debug)]
pub(crate) struct ReplayableQueryResultHandle {
    pub result_set_id: String,
    pub tab_id: String,
    pub connection_id: String,
    pub sql: String,
    pub columns: Vec<QueryResultColumn>,
    cache: Mutex<ReplayableQueryResultCache>,
    query_lock: AsyncMutex<()>,
}

pub(crate) struct ReplayableQueryResultHandleInit {
    pub result_set_id: String,
    pub tab_id: String,
    pub connection_id: String,
    pub sql: String,
    pub columns: Vec<QueryResultColumn>,
    pub page_size: usize,
    pub initial_rows: Vec<Vec<QueryResultCell>>,
    pub has_more_rows: bool,
}

#[derive(Debug)]
pub(crate) struct BufferedQueryResultHandle {
    pub result_set_id: String,
    pub tab_id: String,
    pub columns: Vec<QueryResultColumn>,
    pub rows: Vec<Vec<QueryResultCell>>,
}

#[derive(Debug)]
pub(crate) enum QueryResultHandle {
    Replayable(ReplayableQueryResultHandle),
    Buffered(BufferedQueryResultHandle),
}

impl ReplayableQueryResultHandle {
    pub(crate) fn new(init: ReplayableQueryResultHandleInit) -> Self {
        Self {
            result_set_id: init.result_set_id,
            tab_id: init.tab_id,
            connection_id: init.connection_id,
            sql: init.sql,
            columns: init.columns,
            cache: Mutex::new(ReplayableQueryResultCache {
                descriptor_signature: build_replayable_descriptor_signature(None, &[], ""),
                count_signature: build_replayable_count_signature(&[], ""),
                page_size: init.page_size,
                pages: build_cached_pages(init.page_size, 0, init.initial_rows, init.has_more_rows),
                total_row_count: None,
            }),
            query_lock: AsyncMutex::new(()),
        }
    }

    pub(crate) async fn lock_query(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.query_lock.lock().await
    }

    pub(crate) fn cache_snapshot(&self) -> ReplayableQueryCacheSnapshot {
        let cache = self.cache.lock().expect("replayable cache lock poisoned");
        ReplayableQueryCacheSnapshot {
            descriptor_signature: cache.descriptor_signature.clone(),
            cached_page_indexes: cache.pages.keys().copied().collect(),
        }
    }

    pub(crate) fn page_size(&self) -> usize {
        self.cache
            .lock()
            .expect("replayable cache lock poisoned")
            .page_size
    }

    pub(crate) fn replace_cached_page_batch(
        &self,
        descriptor_signature: String,
        count_signature: String,
        page_start_index: usize,
        rows: Vec<Vec<QueryResultCell>>,
        has_more_rows_after_batch: bool,
    ) {
        let mut cache = self.cache.lock().expect("replayable cache lock poisoned");
        let total_row_count = if cache.count_signature == count_signature {
            cache.total_row_count
        } else {
            None
        };
        *cache = ReplayableQueryResultCache {
            descriptor_signature,
            count_signature,
            page_size: cache.page_size,
            pages: build_cached_pages(
                cache.page_size,
                page_start_index,
                rows,
                has_more_rows_after_batch,
            ),
            total_row_count,
        };
    }

    pub(crate) fn store_cached_page_batch(
        &self,
        descriptor_signature: &str,
        page_start_index: usize,
        rows: Vec<Vec<QueryResultCell>>,
        has_more_rows_after_batch: bool,
        anchor_range: ReplayablePageRange,
    ) -> bool {
        let mut cache = self.cache.lock().expect("replayable cache lock poisoned");
        if cache.descriptor_signature != descriptor_signature {
            return false;
        }

        for (page_index, page) in build_cached_pages(
            cache.page_size,
            page_start_index,
            rows,
            has_more_rows_after_batch,
        ) {
            cache.pages.insert(page_index, page);
        }
        evict_cached_pages(&mut cache.pages, anchor_range);
        true
    }

    pub(crate) fn set_total_row_count_if_current(
        &self,
        count_signature: &str,
        total_row_count: usize,
    ) -> bool {
        let mut cache = self.cache.lock().expect("replayable cache lock poisoned");
        if cache.count_signature != count_signature {
            return false;
        }

        cache.total_row_count = Some(total_row_count);
        true
    }

    pub(crate) fn summary(&self) -> QueryResultSetSummary {
        let cache = self.cache.lock().expect("replayable cache lock poisoned");
        QueryResultSetSummary {
            result_set_id: self.result_set_id.clone(),
            columns: self.columns.clone(),
            buffered_row_count: buffered_row_count(&cache.pages),
            total_row_count: cache.total_row_count,
            has_more_rows: cache_has_more_rows(&cache),
            status: QueryResultStatus::Completed,
        }
    }

    pub(crate) fn load_window(&self, request: &QueryResultWindowRequest) -> QueryResultWindow {
        let cache = self.cache.lock().expect("replayable cache lock poisoned");
        let requested_range =
            replayable_page_range_for_window(request.offset, request.limit, cache.page_size);
        let request_end = request.offset.saturating_add(request.limit);
        let mut rows = Vec::with_capacity(request.limit);

        for page_index in requested_range.start..=requested_range.end {
            let Some(page) = cache.pages.get(&page_index) else {
                continue;
            };
            let page_offset = page_index.saturating_mul(cache.page_size);
            let start = request
                .offset
                .saturating_sub(page_offset)
                .min(page.rows.len());
            let end = request_end.saturating_sub(page_offset).min(page.rows.len());
            if start >= end {
                continue;
            }
            rows.extend(page.rows[start..end].iter().cloned());
        }

        let visible_row_count = cache_visible_row_count_for_request(
            &cache,
            requested_range,
            request.offset,
            rows.len(),
        );

        QueryResultWindow {
            result_set_id: self.result_set_id.clone(),
            offset: request.offset,
            limit: request.limit,
            rows,
            visible_row_count,
            buffered_row_count: buffered_row_count(&cache.pages),
            total_row_count: cache.total_row_count,
            has_more_rows: cache_has_more_rows(&cache),
            status: QueryResultStatus::Completed,
            sort: request.sort.clone(),
            filters: request.filters.clone(),
            quick_filter: request.quick_filter.clone(),
        }
    }
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
            Self::Replayable(handle) => handle.summary(),
            Self::Buffered(handle) => {
                let row_count = handle.rows.len();
                QueryResultSetSummary {
                    result_set_id: handle.result_set_id.clone(),
                    columns: handle.columns.clone(),
                    buffered_row_count: row_count,
                    total_row_count: Some(row_count),
                    has_more_rows: false,
                    status: QueryResultStatus::Completed,
                }
            }
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct QueryResultStore {
    handles: Arc<AsyncMutex<HashMap<String, Arc<QueryResultHandle>>>>,
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
        let visible_row_count = visible_indexes.len();

        QueryResultWindow {
            result_set_id: self.result_set_id.clone(),
            offset: request.offset,
            limit: request.limit,
            rows,
            visible_row_count,
            buffered_row_count: visible_row_count,
            total_row_count: Some(visible_row_count),
            has_more_rows: false,
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

pub(crate) fn replayable_page_range_for_window(
    offset: usize,
    limit: usize,
    page_size: usize,
) -> ReplayablePageRange {
    let start = offset / page_size;
    let end = offset.saturating_add(limit).saturating_sub(1) / page_size;

    ReplayablePageRange { start, end }
}

pub(crate) fn build_replayable_descriptor_signature(
    sort: Option<&QueryResultSort>,
    filters: &[QueryResultFilter],
    quick_filter: &str,
) -> String {
    serde_json::to_string(&(sort, filters, quick_filter))
        .expect("replayable descriptor signature should serialize")
}

pub(crate) fn build_replayable_count_signature(
    filters: &[QueryResultFilter],
    quick_filter: &str,
) -> String {
    serde_json::to_string(&(filters, quick_filter))
        .expect("replayable count signature should serialize")
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
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(left), Some(right)) => left.cmp(&right),
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

fn build_cached_pages(
    page_size: usize,
    page_start_index: usize,
    rows: Vec<Vec<QueryResultCell>>,
    has_more_rows_after_batch: bool,
) -> BTreeMap<usize, ReplayableQueryResultPage> {
    rows.chunks(page_size)
        .enumerate()
        .map(|(index, chunk)| {
            let page_index = page_start_index + index;
            let has_more_rows_after =
                index < rows.len().saturating_sub(1) / page_size || has_more_rows_after_batch;

            (
                page_index,
                ReplayableQueryResultPage {
                    rows: chunk.to_vec(),
                    has_more_rows_after,
                },
            )
        })
        .collect()
}

fn buffered_row_count(pages: &BTreeMap<usize, ReplayableQueryResultPage>) -> usize {
    pages.values().map(|page| page.rows.len()).sum()
}

fn cache_has_more_rows(cache: &ReplayableQueryResultCache) -> bool {
    if let Some(total_row_count) = cache.total_row_count {
        return buffered_row_count(&cache.pages) < total_row_count;
    }

    cache
        .pages
        .first_key_value()
        .map(|(page_index, _)| *page_index > 0)
        .unwrap_or(false)
        || cache.pages.values().any(|page| page.has_more_rows_after)
}

fn cache_visible_row_count_for_request(
    cache: &ReplayableQueryResultCache,
    requested_range: ReplayablePageRange,
    request_offset: usize,
    rows_in_window: usize,
) -> usize {
    if let Some(total_row_count) = cache.total_row_count {
        return total_row_count;
    }

    let current_end = request_offset.saturating_add(rows_in_window);
    let highest_known_row_exclusive = cache
        .pages
        .iter()
        .map(|(page_index, page)| page_index.saturating_mul(cache.page_size) + page.rows.len())
        .max()
        .unwrap_or(0);
    let has_more_beyond_current_window = cache
        .pages
        .range((requested_range.end + 1)..)
        .next()
        .is_some()
        || cache
            .pages
            .get(&requested_range.end)
            .map(|page| page.has_more_rows_after)
            .unwrap_or(false);

    highest_known_row_exclusive
        .max(current_end.saturating_add(usize::from(has_more_beyond_current_window)))
}

fn evict_cached_pages(
    pages: &mut BTreeMap<usize, ReplayableQueryResultPage>,
    anchor_range: ReplayablePageRange,
) {
    const MAX_CACHED_PAGES: usize = 4;

    if pages.len() <= MAX_CACHED_PAGES {
        return;
    }

    let mut page_indexes = pages.keys().copied().collect::<Vec<_>>();
    page_indexes.sort_by_key(|page_index| {
        let distance = if *page_index < anchor_range.start {
            anchor_range.start - *page_index
        } else {
            page_index.saturating_sub(anchor_range.end)
        };

        (distance, *page_index)
    });

    for page_index in page_indexes.into_iter().skip(MAX_CACHED_PAGES) {
        pages.remove(&page_index);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_replayable_count_signature, build_replayable_descriptor_signature,
        replayable_page_range_for_window, ReplayablePageRange, ReplayableQueryResultHandle,
        ReplayableQueryResultHandleInit,
    };
    use crate::foundation::{
        QueryResultCell, QueryResultColumn, QueryResultColumnSemanticType, QueryResultWindowRequest,
    };

    #[test]
    fn replayable_window_uses_visible_row_estimate_for_deep_cached_pages() {
        let handle = test_handle(3, vec![vec![QueryResultCell::Integer(0)]], true);
        let descriptor_signature = build_replayable_descriptor_signature(None, &[], "");
        let count_signature = build_replayable_count_signature(&[], "");

        handle.replace_cached_page_batch(
            descriptor_signature,
            count_signature,
            4,
            vec![
                vec![QueryResultCell::Integer(12)],
                vec![QueryResultCell::Integer(13)],
                vec![QueryResultCell::Integer(14)],
            ],
            false,
        );

        let window = handle.load_window(&QueryResultWindowRequest {
            result_set_id: "result-1".to_string(),
            offset: 12,
            limit: 3,
            sort: None,
            filters: Vec::new(),
            quick_filter: String::new(),
        });

        assert_eq!(window.rows.len(), 3);
        assert_eq!(window.buffered_row_count, 3);
        assert_eq!(window.visible_row_count, 15);
        assert!(window.has_more_rows);
    }

    #[test]
    fn replayable_window_reads_rows_across_cached_pages() {
        let handle = test_handle(
            3,
            vec![
                vec![QueryResultCell::Integer(0)],
                vec![QueryResultCell::Integer(1)],
                vec![QueryResultCell::Integer(2)],
            ],
            true,
        );
        let descriptor_signature = build_replayable_descriptor_signature(None, &[], "");

        assert!(handle.store_cached_page_batch(
            &descriptor_signature,
            1,
            vec![
                vec![QueryResultCell::Integer(3)],
                vec![QueryResultCell::Integer(4)],
                vec![QueryResultCell::Integer(5)],
            ],
            false,
            ReplayablePageRange { start: 0, end: 1 },
        ));

        let window = handle.load_window(&QueryResultWindowRequest {
            result_set_id: "result-1".to_string(),
            offset: 2,
            limit: 4,
            sort: None,
            filters: Vec::new(),
            quick_filter: String::new(),
        });

        assert_eq!(
            window.rows,
            vec![
                vec![QueryResultCell::Integer(2)],
                vec![QueryResultCell::Integer(3)],
                vec![QueryResultCell::Integer(4)],
                vec![QueryResultCell::Integer(5)],
            ]
        );
    }

    #[test]
    fn replayable_page_cache_evicts_pages_farthest_from_current_viewport() {
        let handle = test_handle(
            3,
            vec![
                vec![QueryResultCell::Integer(0)],
                vec![QueryResultCell::Integer(1)],
                vec![QueryResultCell::Integer(2)],
            ],
            true,
        );
        let descriptor_signature = build_replayable_descriptor_signature(None, &[], "");

        assert!(handle.store_cached_page_batch(
            &descriptor_signature,
            1,
            (3..15)
                .map(|value| vec![QueryResultCell::Integer(value)])
                .collect(),
            false,
            ReplayablePageRange { start: 2, end: 4 },
        ));

        let snapshot = handle.cache_snapshot();
        assert_eq!(snapshot.cached_page_indexes, vec![1, 2, 3, 4]);
    }

    #[test]
    fn replayable_page_range_maps_window_offsets_to_page_indexes() {
        assert_eq!(
            replayable_page_range_for_window(290, 40, 300),
            ReplayablePageRange { start: 0, end: 1 }
        );
    }

    fn test_result_column() -> QueryResultColumn {
        QueryResultColumn {
            name: "value".to_string(),
            postgres_type: "int4".to_string(),
            semantic_type: QueryResultColumnSemanticType::Number,
            is_nullable: false,
        }
    }

    fn test_handle(
        page_size: usize,
        initial_rows: Vec<Vec<QueryResultCell>>,
        has_more_rows: bool,
    ) -> ReplayableQueryResultHandle {
        ReplayableQueryResultHandle::new(ReplayableQueryResultHandleInit {
            result_set_id: "result-1".to_string(),
            tab_id: "tab-1".to_string(),
            connection_id: "conn-1".to_string(),
            sql: "select 1".to_string(),
            columns: vec![test_result_column()],
            page_size,
            initial_rows,
            has_more_rows,
        })
    }
}
