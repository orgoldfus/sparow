alter table schema_cache add column display_name text not null default '';
alter table schema_cache add column parent_path text;
alter table schema_cache add column schema_name text;
alter table schema_cache add column relation_name text;
alter table schema_cache add column position integer;
alter table schema_cache add column has_children integer not null default 0;

create table if not exists schema_cache_scopes (
  connection_profile_id text not null,
  scope_path text not null,
  scope_kind text not null,
  refreshed_at text not null,
  refresh_status text not null,
  primary key (connection_profile_id, scope_path)
);

create index if not exists idx_schema_cache_parent
  on schema_cache (connection_profile_id, parent_path);

create index if not exists idx_schema_cache_display_name
  on schema_cache (connection_profile_id, display_name);

create index if not exists idx_schema_cache_object_path
  on schema_cache (connection_profile_id, object_path);

create index if not exists idx_schema_cache_scopes_lookup
  on schema_cache_scopes (connection_profile_id, scope_path);
