-- Migration 073 : cache des pré-analyses de scène (Studio Designer)
--
-- Stocke le résultat de /api/comfyui/analyze-scene pour chaque image source.
-- Permet :
--   - Au reload d'une scène : restaurer les silhouettes hover/click sans
--     relancer l'analyse (~80-100s économisées par session)
--   - Cross-scene reuse : si la même image est utilisée dans plusieurs plans,
--     l'analyse n'est faite qu'une fois
--
-- Modèle "catalogue" :
--   - Les masks PNG restent dans Supabase storage (URLs dans `detections`)
--   - Cette table = juste l'index des objets détectés par image
--   - La promotion en calque (création d'EditorLayer type "objet") est un
--     acte SÉPARÉ et explicite, pas couvert par cette table
--
-- Clé de cache : image_url (un seul résultat par URL d'image source).

CREATE TABLE IF NOT EXISTS scene_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- URL Supabase de l'image source (clé de cache).
  -- UNIQUE car on ne stocke qu'un résultat par image (re-analyse = upsert).
  image_url TEXT NOT NULL UNIQUE,

  -- Stratégie utilisée pour générer ces détections.
  -- 'f_qwen_sam1hq' = Florence + Qwen + DINO + SAM 1 HQ (validée 2026-04-28).
  -- Si on change de stratégie un jour, on peut invalider le cache via cette colonne.
  strategy TEXT NOT NULL DEFAULT 'f_qwen_sam1hq',

  -- Catalogue des objets détectés. Format JSONB :
  --   [
  --     {
  --       "id": "obj_xxx",
  --       "label": "throw pillows",
  --       "source": "od" | "dense",
  --       "bbox": [x1, y1, x2, y2],          -- normalisé 0-1
  --       "bbox_pixels": [x1, y1, x2, y2],   -- pixels source
  --       "mask_url": "https://...png"        -- mask binaire dans Supabase
  --     },
  --     ...
  --   ]
  detections JSONB NOT NULL,

  -- Dimensions de l'image source (pour reconstruire les bboxes pixels au besoin).
  image_width  INTEGER,
  image_height INTEGER,

  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scene_analyses_image_url ON scene_analyses(image_url);
CREATE INDEX IF NOT EXISTS idx_scene_analyses_analyzed_at ON scene_analyses(analyzed_at DESC);

-- Trigger pour auto-update du updated_at (optionnel mais utile pour debug)
CREATE OR REPLACE FUNCTION trigger_scene_analyses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scene_analyses_updated_at ON scene_analyses;
CREATE TRIGGER scene_analyses_updated_at
  BEFORE UPDATE ON scene_analyses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_scene_analyses_updated_at();

-- Pas de RLS pour l'instant (admin-only via service role).
-- À activer si on ouvre l'API au public côté reader.
