-- Migration 074 : extensions Plan Animation + Bank uploads externes
--
-- Cf. décisions session 2026-05-03 (mémoire `project_plan_kind_data_model.md`,
-- `project_plan_bank_order.md`, `project_plan_tags_strategy.md`).
--
-- Cette migration NE TOUCHE PAS au schema existant de `sections.images` (JSONB).
-- Les nouveaux champs `kind`, `base_video_url`, `first_frame_url`, `last_frame_url`,
-- `tags` vivent désormais dans les objets de l'array JSONB et sont gérés via le
-- type TS étendu `SectionImage` dans `admin/src/types/index.ts`.
--
-- Rétro-compat : un objet `images[i]` sans `kind` est traité comme `kind='image'`
-- (cf code lecture admin).
--
-- Cette migration ajoute UNIQUEMENT :
--   1. Une table `bank_uploads` pour les images/animations uploadées hors d'une
--      section (utilisées comme source dans la banque d'images du Studio Designer).
--   2. Des commentaires de documentation sur sections.images.

-- ── Table : uploads externes pour la banque ──────────────────────────────

CREATE TABLE IF NOT EXISTS bank_uploads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id           UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,

  -- Type de l'asset uploadé. Mêmes valeurs que SectionImage.kind.
  kind              TEXT NOT NULL DEFAULT 'image'
                      CHECK (kind IN ('image', 'animation')),

  -- URL du média principal (image JPG/PNG si kind='image', MP4 si kind='animation').
  url               TEXT NOT NULL,

  -- Pour kind='animation' : URLs des frames extraites (par /api/comfyui/extract-frames).
  -- Permettent à la banque d'afficher la mini-galerie sans charger le MP4 entier.
  -- Null pour kind='image'.
  first_frame_url   TEXT,
  last_frame_url    TEXT,

  -- Tags du upload. Format identique à PlanTags (cf TS).
  -- Pour les uploads externes, ces tags sont initialement vides puis suggérés
  -- par Qwen VL local (cf `project_plan_tags_strategy.md`) ou saisis manuellement.
  tags              JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Métadonnées
  name              TEXT,                  -- nom affiché (ex: nom du fichier sans ext)
  uploaded_by       TEXT,                  -- user_id ou email pour audit (optionnel)
  source            TEXT DEFAULT 'upload'  -- 'upload' | 'fetch_url' | autre futur
                      CHECK (source IN ('upload', 'fetch_url')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_uploads_book_id  ON bank_uploads(book_id);
CREATE INDEX IF NOT EXISTS idx_bank_uploads_kind     ON bank_uploads(book_id, kind);
CREATE INDEX IF NOT EXISTS idx_bank_uploads_created  ON bank_uploads(book_id, created_at DESC);
-- GIN pour recherche sur tags (jsonb_path_ops = + rapide pour @> et ->>)
CREATE INDEX IF NOT EXISTS idx_bank_uploads_tags     ON bank_uploads USING GIN (tags jsonb_path_ops);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_bank_uploads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bank_uploads_updated_at ON bank_uploads;
CREATE TRIGGER trg_bank_uploads_updated_at
  BEFORE UPDATE ON bank_uploads
  FOR EACH ROW
  EXECUTE FUNCTION update_bank_uploads_updated_at();

-- ── Documentation ─────────────────────────────────────────────────────────

COMMENT ON TABLE  bank_uploads IS
  'Images/animations uploadées hors d''une section, utilisées dans la banque '
  'd''images du Studio Designer (priorité 5 après plans existants/transitions).';
COMMENT ON COLUMN bank_uploads.kind IS
  'image | animation. Mêmes valeurs que SectionImage.kind (cf TS).';
COMMENT ON COLUMN bank_uploads.first_frame_url IS
  'Première frame du MP4 si kind=animation. Capturée à l''upload pour vignette banque.';
COMMENT ON COLUMN bank_uploads.last_frame_url IS
  'Dernière frame du MP4 si kind=animation. État final, cf décision "joue 1× puis fige".';
COMMENT ON COLUMN bank_uploads.tags IS
  'Tags JSON {kind, sections[], location, characters[], effects[], objects[], manual_overrides[]}. '
  'Cf PlanTags TypeScript et `project_plan_tags_strategy.md`.';

-- Documentation sur les nouveaux champs JSONB de sections.images
COMMENT ON COLUMN sections.images IS
  'Plans de la section (array JSONB). Chaque item = SectionImage TS étendu : '
  'url, kind (image|animation), base_video_url, first_frame_url, last_frame_url, '
  'tags, prompts, comfyui_settings, plan_prefs, etc. '
  'Cf admin/src/types/index.ts et `project_plan_kind_data_model.md` (décision 2026-05-03).';
