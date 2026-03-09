create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at text not null
);

create table if not exists saved_connections (
  id text primary key,
  name text not null,
  host text not null,
  port integer not null,
  database_name text not null,
  username text not null,
  ssl_mode text not null,
  secret_ref_json text,
  created_at text not null,
  updated_at text not null
);

create table if not exists saved_queries (
  id text primary key,
  title text not null,
  sql text not null,
  tags_json text not null default '[]',
  updated_at text not null
);

create table if not exists query_history (
  id text primary key,
  sql text not null,
  connection_profile_id text,
  created_at text not null
);

create table if not exists schema_cache (
  id text primary key,
  connection_profile_id text not null,
  object_kind text not null,
  object_path text not null,
  payload_json text not null,
  refreshed_at text not null
);
