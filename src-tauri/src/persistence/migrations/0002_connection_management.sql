alter table saved_connections add column engine text not null default 'postgresql';
alter table saved_connections add column last_tested_at text;
alter table saved_connections add column last_connected_at text;
