-- Icône custom par combat move (image uploadée ou générée)
alter table combat_moves add column if not exists icon_url text default null;
