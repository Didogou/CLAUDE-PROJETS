-- Table des personnages non joueurs (PNJ) par livre
create table npcs (
  id              uuid        primary key default uuid_generate_v4(),
  book_id         uuid        not null references books(id) on delete cascade,
  name            text        not null,
  type            text        not null default 'ennemi' check (type in ('ennemi', 'boss', 'allié', 'neutre', 'marchand')),
  description     text,
  force           integer     not null default 5,
  agilite         integer     not null default 5,
  intelligence    integer     not null default 5,
  magie           integer     not null default 0,
  endurance       integer     not null default 10,
  chance          integer     not null default 5,
  special_ability text,
  resistances     text,
  loot            text,
  created_at      timestamptz default now()
);

alter table npcs enable row level security;

create policy "npcs: lecture publique si livre publié"
  on npcs for select
  using (exists (select 1 from books where books.id = npcs.book_id and books.status = 'published'));

create policy "npcs: admin accès total"
  on npcs for all
  using (auth.role() = 'service_role');
