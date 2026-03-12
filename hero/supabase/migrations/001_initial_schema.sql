-- ============================================================
-- HERO — Schéma initial de la base de données
-- ============================================================

-- Extension UUID
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLE : books
-- ============================================================
create table books (
  id              uuid        primary key default uuid_generate_v4(),
  title           text        not null,
  theme           text        not null,
  age_range       text        not null check (age_range in ('8-12', '13-17', '18+')),
  context_type    text        not null,
  language        text        not null default 'fr' check (language in ('fr', 'en')),
  status          text        not null default 'draft' check (status in ('draft', 'published', 'archived')),
  cover_image_url text,
  description     text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================
-- TABLE : jobs (métiers — définis par livre)
-- ============================================================
create table jobs (
  id              uuid        primary key default uuid_generate_v4(),
  book_id         uuid        not null references books(id) on delete cascade,
  name            text        not null,
  name_en         text,
  description     text,
  description_en  text,
  stat_modifiers  jsonb       not null default '{}',
  -- ex: {"force": 3, "endurance": 2, "agilite": -1, "magie": -2}
  starting_items  jsonb       not null default '[]',
  -- ex: [{"id": "sword_01", "name": "Épée", "type": "arme", "effect": {"stat": "force", "bonus": 2}}]
  created_at      timestamptz default now()
);

-- ============================================================
-- TABLE : sections
-- ============================================================
create table sections (
  id              uuid        primary key default uuid_generate_v4(),
  book_id         uuid        not null references books(id) on delete cascade,
  number          integer     not null,
  content         text        not null,
  content_en      text,
  image_url       text,
  animation_key   text,
  trial           jsonb,
  -- Structure trial:
  -- {
  --   "type": "combat" | "agilite" | "intelligence" | "magie" | "chance" | "crochetage",
  --   "stat": "force" | "agilite" | "intelligence" | "magie" | "chance",
  --   "success_section_id": "uuid",
  --   "failure_section_id": "uuid",
  --   "enemy": { "name": "...", "force": 8, "endurance": 12 },
  --   "mana_cost": 0,
  --   "endurance_loss_on_failure": 2
  -- }
  is_ending       boolean     not null default false,
  ending_type     text        check (ending_type in ('victory', 'death')),
  created_at      timestamptz default now(),
  unique(book_id, number)
);

-- ============================================================
-- TABLE : choices
-- ============================================================
create table choices (
  id                uuid        primary key default uuid_generate_v4(),
  section_id        uuid        not null references sections(id) on delete cascade,
  label             text        not null,
  label_en          text,
  target_section_id uuid        references sections(id),
  requires_trial    boolean     not null default false,
  condition         jsonb,
  -- ex: {"stat": "magie", "min": 6}  ou  {"item_id": "cle_tour"}
  sort_order        integer     not null default 0,
  created_at        timestamptz default now()
);

-- ============================================================
-- TABLE : section_items (objets trouvables dans les sections)
-- ============================================================
create table section_items (
  id           uuid        primary key default uuid_generate_v4(),
  section_id   uuid        not null references sections(id) on delete cascade,
  item_id      text        not null,
  name         text        not null,
  name_en      text,
  type         text        not null check (type in ('soin', 'mana', 'arme', 'armure', 'outil', 'quete', 'grimoire')),
  description  text,
  effect       jsonb       not null default '{}',
  -- ex: {"hp_restore": 4}  ou  {"stat": "force", "bonus": 2}  ou  {"mana_restore": 3}
  quantity     integer     not null default 1,
  auto_pickup  boolean     not null default false,
  created_at   timestamptz default now()
);

-- ============================================================
-- TABLE : user_progress
-- ============================================================
create table user_progress (
  id                 uuid        primary key default uuid_generate_v4(),
  user_id            text        not null,  -- device_id (anonyme) ou auth.uid()
  book_id            uuid        not null references books(id) on delete cascade,
  current_section_id uuid        references sections(id),
  character          jsonb       not null default '{}',
  -- Structure character:
  -- {
  --   "name": "Aldric",
  --   "job": "Chevalier",
  --   "stats": {
  --     "force":       { "base": 9,  "current": 6 },
  --     "agilite":     { "base": 7,  "current": 7 },
  --     "intelligence":{ "base": 6,  "current": 4 },
  --     "magie":       { "base": 3,  "current": 3 },
  --     "endurance":   { "base": 14, "max": 14, "current": 8 },
  --     "chance":      { "base": 6,  "current": 5 }
  --   },
  --   "injuries": [
  --     { "name": "Bras cassé", "stat": "force", "malus": -3, "cured": false }
  --   ],
  --   "inventory": [
  --     { "id": "sword_01", "name": "Épée enchantée", "type": "arme", "effect": {"stat": "force", "bonus": 2} },
  --     { "id": "potion_01", "name": "Potion de soin", "type": "soin", "hp_restore": 4, "quantity": 2 }
  --   ]
  -- }
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique(user_id, book_id)
);

-- ============================================================
-- FUNCTION : auto-update updated_at
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger books_updated_at
  before update on books
  for each row execute function update_updated_at();

create trigger user_progress_updated_at
  before update on user_progress
  for each row execute function update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
alter table books          enable row level security;
alter table jobs           enable row level security;
alter table sections       enable row level security;
alter table choices        enable row level security;
alter table section_items  enable row level security;
alter table user_progress  enable row level security;

-- Livres publiés : lisibles par tous
create policy "books: lecture publique si publié"
  on books for select
  using (status = 'published');

-- Admin (service_role) : accès total à toutes les tables
create policy "books: admin accès total"
  on books for all
  using (auth.role() = 'service_role');

create policy "jobs: lecture publique si livre publié"
  on jobs for select
  using (
    exists (select 1 from books where books.id = jobs.book_id and books.status = 'published')
  );
create policy "jobs: admin accès total"
  on jobs for all
  using (auth.role() = 'service_role');

create policy "sections: lecture publique si livre publié"
  on sections for select
  using (
    exists (select 1 from books where books.id = sections.book_id and books.status = 'published')
  );
create policy "sections: admin accès total"
  on sections for all
  using (auth.role() = 'service_role');

create policy "choices: lecture publique si livre publié"
  on choices for select
  using (
    exists (
      select 1 from sections s
      join books b on b.id = s.book_id
      where s.id = choices.section_id and b.status = 'published'
    )
  );
create policy "choices: admin accès total"
  on choices for all
  using (auth.role() = 'service_role');

create policy "section_items: lecture publique si livre publié"
  on section_items for select
  using (
    exists (
      select 1 from sections s
      join books b on b.id = s.book_id
      where s.id = section_items.section_id and b.status = 'published'
    )
  );
create policy "section_items: admin accès total"
  on section_items for all
  using (auth.role() = 'service_role');

-- Progression : chaque utilisateur gère la sienne
create policy "user_progress: accès à sa propre progression"
  on user_progress for all
  using (user_id = coalesce(auth.uid()::text, current_setting('request.headers', true)::json->>'x-device-id'));

create policy "user_progress: admin accès total"
  on user_progress for all
  using (auth.role() = 'service_role');
