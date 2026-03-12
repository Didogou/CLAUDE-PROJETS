-- Ajout du statut de révision par section (pour le workflow admin)
alter table sections
  add column if not exists status text not null default 'draft'
  check (status in ('draft', 'in_progress', 'validated'));
