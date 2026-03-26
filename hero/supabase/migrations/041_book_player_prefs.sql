alter table books
  add column if not exists player_prefs jsonb default null;
