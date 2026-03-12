alter table books
  add column if not exists difficulty text not null default 'normal'
  check (difficulty in ('facile', 'normal', 'difficile', 'expert'));
