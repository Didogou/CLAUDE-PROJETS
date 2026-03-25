alter table books add column if not exists project_id uuid references projects(id) on delete set null;
alter table books add column if not exists order_in_series integer default 0;
alter table books add column if not exists book_summary text;
alter table books add column if not exists phase text default null
  check (phase is null or phase in ('draft','structure_generated','structure_validated','writing','done'));
create index if not exists books_project_id_idx on books(project_id);
