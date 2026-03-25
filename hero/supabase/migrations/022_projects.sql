create table if not exists projects (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  theme         text not null,
  num_books     integer not null default 1,
  description   text,
  series_bible  text,
  series_analysis text,
  status        text not null default 'draft'
    check (status in ('draft','bible_generated','bible_validated','in_progress','completed')),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
