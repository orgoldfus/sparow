create table if not exists query_result_sets (
  result_set_id text primary key,
  job_id text not null,
  tab_id text not null,
  connection_profile_id text not null,
  sql text not null,
  columns_json text not null,
  buffered_row_count integer not null default 0,
  total_row_count integer,
  status text not null,
  created_at text not null,
  completed_at text,
  last_error_json text
);

create table if not exists query_result_rows (
  result_set_id text not null,
  row_index integer not null,
  row_json text not null,
  primary key (result_set_id, row_index)
);

create index if not exists idx_query_result_sets_tab_id
  on query_result_sets (tab_id);

create index if not exists idx_query_result_rows_result_set_id
  on query_result_rows (result_set_id, row_index);
