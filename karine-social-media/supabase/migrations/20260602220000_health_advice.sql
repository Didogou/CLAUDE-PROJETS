-- ============================================================
-- Conseils santé : structure identique aux astuces (tips).
-- Karine publie des planches multi-slides (recommandations, principes
-- nutritionnels, infos santé) avec un cover en première slide.
-- ============================================================

create table if not exists public.health_advice (
  id              bigserial primary key,
  slug            text not null unique,
  label           text not null,
  slides          text[] not null default array[]::text[],
  tags            text[] not null default array[]::text[],
  likes_count     integer not null default 0,
  status          text not null default 'draft' check (status in ('draft', 'published')),
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null
);

create index if not exists health_advice_status_published_idx
  on public.health_advice (status, published_at desc);

drop trigger if exists health_advice_set_updated_at on public.health_advice;
create trigger health_advice_set_updated_at
  before update on public.health_advice
  for each row execute function public.set_updated_at();

alter table public.health_advice enable row level security;

-- Lecture : admin ou abonnée active sur les publiés
drop policy if exists health_advice_select_admin_or_subscriber on public.health_advice;
create policy health_advice_select_admin_or_subscriber on public.health_advice
  for select using (
    public.is_admin(auth.uid())
    or (public.has_active_subscription(auth.uid()) and status = 'published')
  );

-- Écriture admin uniquement
drop policy if exists health_advice_admin_all on public.health_advice;
create policy health_advice_admin_all on public.health_advice
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
