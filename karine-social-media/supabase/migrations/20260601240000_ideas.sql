-- Feature 3 + 4 : système d'idées soumises par les utilisateurs (recette,
-- astuce, question). Karine peut répondre depuis /admin/idees ; la réponse
-- déclenche une notification (type idea_reply) + un email.

create table if not exists public.ideas (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  type          text not null check (type in ('recette', 'astuce', 'question')),
  title         text not null check (char_length(title) between 1 and 160),
  body          text not null check (char_length(body) between 1 and 4000),
  status        text not null default 'new' check (status in ('new', 'replied', 'archived')),
  reply         text,
  replied_at    timestamptz,
  replied_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists ideas_user_idx       on public.ideas (user_id, created_at desc);
create index if not exists ideas_status_idx     on public.ideas (status, created_at desc);

alter table public.ideas enable row level security;

-- Lecture : owner OU admin
drop policy if exists ideas_select_self_or_admin on public.ideas;
create policy ideas_select_self_or_admin on public.ideas
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Insertion : user lui-même (route POST utilisera service-role mais on garde
-- la policy alignée pour cohérence)
drop policy if exists ideas_insert_self on public.ideas;
create policy ideas_insert_self on public.ideas
  for insert with check (user_id = auth.uid());

-- Update : admin seulement (réponse, statut)
drop policy if exists ideas_update_admin on public.ideas;
create policy ideas_update_admin on public.ideas
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

comment on table public.ideas is 'Idées soumises par les utilisateurs (recette/astuce/question), Karine répond depuis admin.';
