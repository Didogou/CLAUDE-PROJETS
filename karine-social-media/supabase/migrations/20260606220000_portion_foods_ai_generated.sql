-- ============================================================
-- portion_foods : flag "généré par IA, à valider par Karine"
-- ============================================================
-- Quand l'API parse rencontre un aliment absent de la grille
-- (ex: "pâté en croûte"), on demande à Mistral une estimation de
-- portion_g et on INSÈRE automatiquement une ligne dans portion_foods.
-- Cette ligne porte ai_generated=true pour signaler à Karine qu'elle
-- doit la valider ou la corriger.
--
-- Une fois validée (clic explicite dans l'admin), Karine met
-- ai_generated=false, l'aliment devient "officiel" et n'aura plus
-- le badge.

alter table public.portion_foods
  add column if not exists ai_generated boolean not null default false;

comment on column public.portion_foods.ai_generated is
  'true = ligne créée automatiquement par Mistral lors d''un parse. Karine doit la valider (mettre à false) ou la corriger.';

-- Index partiel pour requêter rapidement les entrées en attente de validation.
create index if not exists portion_foods_ai_generated_idx
  on public.portion_foods (ai_generated)
  where ai_generated = true;
