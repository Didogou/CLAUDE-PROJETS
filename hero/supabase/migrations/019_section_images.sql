alter table sections add column if not exists images jsonb default '[]'::jsonb;
