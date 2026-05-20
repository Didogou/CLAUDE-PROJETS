-- Migration 076 : ajout colonnes summary + refs NPCs / items sur plans
--
-- Cf. décision design 2026-05-06 (Studio Section UX) : afficher sous chaque
-- Plan cell les vignettes des persos + objets présents + un résumé court.
-- Approche relationnelle (vs JSONB) car npcs et items existent déjà comme
-- tables (cf 003_npcs.sql, 031_items.sql) avec portrait_url / illustration_url.
--
-- L'API /api/plans joindra ces 2 tables pour renvoyer characters[] et items[]
-- complets (avec portraits) au client — évite N+1 fetches côté UI.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS summary text;

-- Refs uuid[] (Postgres array) — pas de FK array native, on valide côté app.
-- ON DELETE CASCADE n'existe pas sur les arrays, donc si un NPC ou item est
-- supprimé, ses refs restent dans plans.npc_ids / item_ids → cleanup possible
-- via trigger ou job batch (Phase ultérieure si besoin).
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS npc_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS item_ids uuid[] NOT NULL DEFAULT '{}';

-- Indexes GIN pour query "tous les plans qui contiennent ce NPC / cet item"
-- (utile pour stats Banque + future feature "où apparaît ce perso").
CREATE INDEX IF NOT EXISTS idx_plans_npc_ids
  ON plans USING GIN (npc_ids);
CREATE INDEX IF NOT EXISTS idx_plans_item_ids
  ON plans USING GIN (item_ids);

COMMENT ON COLUMN plans.summary IS
  'Résumé court 1-2 lignes du plan, anciennement section.images[].description (legacy).';
COMMENT ON COLUMN plans.npc_ids IS
  'IDs des npcs présents dans le plan (vignettes affichées dans le storyboard). '
  'Pas de FK car array — validation côté app, cleanup éventuel via trigger.';
COMMENT ON COLUMN plans.item_ids IS
  'IDs des items présents sur scène dans le plan. Mêmes contraintes que npc_ids.';
