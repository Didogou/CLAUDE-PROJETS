-- Choix par défaut (sélectionné automatiquement quand le countdown atteint 0)
alter table choices add column if not exists is_default boolean not null default false;

-- Position du texte narratif dans l'image de transition du choix
alter table choices add column if not exists transition_text_position jsonb default null;
