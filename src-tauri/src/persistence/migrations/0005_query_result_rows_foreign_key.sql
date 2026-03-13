pragma foreign_keys = off;

create table query_result_rows_next (
  result_set_id text not null,
  row_index integer not null,
  row_json text not null,
  foreign key (result_set_id) references query_result_sets(result_set_id) on delete cascade,
  primary key (result_set_id, row_index)
);

insert into query_result_rows_next (result_set_id, row_index, row_json)
select rows.result_set_id, rows.row_index, rows.row_json
from query_result_rows as rows
inner join query_result_sets as result_sets
  on result_sets.result_set_id = rows.result_set_id;

drop table query_result_rows;

alter table query_result_rows_next rename to query_result_rows;

create index if not exists idx_query_result_rows_result_set_id
  on query_result_rows (result_set_id, row_index);

pragma foreign_keys = on;
