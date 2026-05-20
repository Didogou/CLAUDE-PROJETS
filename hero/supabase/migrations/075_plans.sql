-- Migration 075 : table plans (Plans = entités du storyboard d'une Section)
--
-- Cf. décisions design 2026-05-05/06 (refonte fondamentale Studio Section) :
-- Plan = entité de premier ordre, types static / animation / conversation.
-- Remplace l'ancien modèle pellicules-dans-sections.images JSONB.
--
-- IMPORTANT : Ne touche PAS à `sections.images` (legacy). Les Plans coexistent
-- avec les images legacy le temps de la migration UI. Suppression future de
-- la column `images` en migration séparée quand le code legacy sera retiré.

-- ── Table : plans ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id         UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  section_id      UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,

  -- Position dans la timeline de la Section (1-indexed pour affichage P1/P2/...).
  -- Réordonnable via UPDATE batch côté app (cf Reorder.Group framer-motion).
  sort_order      INTEGER NOT NULL DEFAULT 0,

  -- Type de Plan : drive l'éditeur Designer + le rendu joueur.
  type            TEXT NOT NULL DEFAULT 'static'
                    CHECK (type IN ('static', 'animation', 'conversation')),

  -- Titre éditable par l'auteur (court, 1 ligne, optionnel).
  -- ex: "Travis entre dans le bar", "Choix au comptoir"
  title           TEXT,

  -- Données type-spécifiques en JSONB (cf shape TS Plan.data).
  --
  -- Pour type='static' :
  --   { imageUrl, layers[], effects[], characterIds[] }
  --
  -- Pour type='animation' :
  --   { sequences[], musicUrl }
  --   où chaque sequence = { id, sort_order, sourceImageUrl, videoUrl,
  --                          firstFrameUrl, lastFrameUrl, shot, camera, duration,
  --                          perCharacterAction, generatedAt }
  --
  -- Pour type='conversation' :
  --   { scene: DiscussionScene }   // réutilise le type existant
  data            JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ─────────────────────────────────────────────────────────────

-- Liste storyboard d'une section, ordonnée
CREATE INDEX IF NOT EXISTS idx_plans_section_sort
  ON plans (section_id, sort_order);

-- Stats / banques au niveau livre (ex: tous les plans static d'un livre)
CREATE INDEX IF NOT EXISTS idx_plans_book
  ON plans (book_id);

-- Filter par type au niveau livre (ex: toutes les conversations du livre)
CREATE INDEX IF NOT EXISTS idx_plans_book_type
  ON plans (book_id, type);

-- ── Trigger updated_at (pattern table-spécifique aligné avec bank_uploads) ──

CREATE OR REPLACE FUNCTION update_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW
  EXECUTE FUNCTION update_plans_updated_at();

-- ── RLS (aligné avec sections / choices) ───────────────────────────────

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plans: lecture publique si livre publié"
  ON plans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sections s
      JOIN books b ON b.id = s.book_id
      WHERE s.id = plans.section_id AND b.status = 'published'
    )
  );

CREATE POLICY "plans: admin accès total"
  ON plans FOR ALL
  USING (auth.role() = 'service_role');

-- ── Documentation ───────────────────────────────────────────────────────

COMMENT ON TABLE plans IS
  'Storyboard d''une Section : suite ordonnée de Plans (static/animation/conversation). '
  'Remplace l''ancien modèle pellicules-dans-sections.images JSONB. '
  'Cf décision design 2026-05-05/06 (Studio Section refondé).';

COMMENT ON COLUMN plans.book_id IS
  'FK redondante avec section.book_id (réutilise pattern bank_uploads). '
  'Évite un join pour les queries niveau livre (stats Library, banques).';

COMMENT ON COLUMN plans.sort_order IS
  'Position 0-indexée dans la timeline storyboard de la section. '
  'Affiché 1-indexed côté UI (P1, P2, P3...). Réorganisable.';

COMMENT ON COLUMN plans.type IS
  'static = image fixe avec layers/effets (pause, écran de choix). '
  'animation = sub-timeline de séquences vidéo (LTX). '
  'conversation = arbre dialogue NPC (encapsule DiscussionScene).';

COMMENT ON COLUMN plans.data IS
  'JSONB type-spécifique : {imageUrl, layers[], effects[], characterIds[]} pour static, '
  '{sequences[], musicUrl} pour animation, {scene: DiscussionScene} pour conversation. '
  'Cf TS PlanData dans admin/src/components/studio-section/types.ts.';
