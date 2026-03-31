alter table saved_queries add column connection_profile_id text;
alter table saved_queries add column created_at text;

update saved_queries
set created_at = updated_at
where created_at is null;

create index if not exists idx_query_history_created_at
  on query_history(created_at desc, id desc);

create index if not exists idx_query_history_connection_created_at
  on query_history(connection_profile_id, created_at desc, id desc);

create index if not exists idx_saved_queries_updated_at
  on saved_queries(updated_at desc, id desc);

create index if not exists idx_saved_queries_connection_updated_at
  on saved_queries(connection_profile_id, updated_at desc, id desc);

create index if not exists idx_saved_queries_title_lower
  on saved_queries(lower(title));
