alter table books
  add column if not exists content_mix jsonb not null
  default '{"combat": 20, "chance": 10, "enigme": 10, "magie": 5}';
