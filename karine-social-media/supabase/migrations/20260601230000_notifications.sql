-- Table unifiée de notifications utilisateur.
-- Types V1 (extensible via le champ type) :
--   - new_post        : Karine publie une nouvelle astuce / recette
--   - comment_reply   : Quelqu'un répond à un commentaire que tu as laissé
--   - idea_reply      : Karine répond à une idée que tu as soumise
-- payload contient le contexte d'affichage (titre, lien, etc.) en JSON.

create table if not exists public.notifications (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in ('new_post', 'comment_reply', 'idea_reply')),
  payload     jsonb not null default '{}'::jsonb,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, created_at desc)
  where is_read = false;

create index if not exists notifications_user_all_idx
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

-- L'utilisateur lit ses propres notifs ; admin lit tout
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id or public.is_admin(auth.uid()));

-- L'utilisateur peut marquer ses notifs comme lues
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Admin peut tout faire (création de notifs via service_role en pratique)
drop policy if exists "notifications_admin_all" on public.notifications;
create policy "notifications_admin_all" on public.notifications
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
