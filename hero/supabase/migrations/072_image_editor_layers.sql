-- Migration 072 : calques (layers) pour l'ImageEditor unifié
--
-- Deux tables + colonnes JSONB sur les tables existantes pour porter les stacks
-- de calques des plans / transitions / retours, avec support de réutilisation
-- cross-plan via `layer_assets`.
--
-- Concept :
--   - `layer_assets` : bibliothèque de calques réutilisables au niveau du livre
--     (ex : un calque "brouillard épais" qu'on applique sur plusieurs scènes).
--     Contient la composition du calque + son baked_url + ses métadonnées de génération.
--   - Un plan (dans `sections.plans` JSONB) ou une transition/retour (dans `choices`)
--     contient un array `layers[]` où chaque entrée est SOIT :
--       * un calque inline (`asset_id=null`) avec toutes ses données dans l'objet
--       * une référence à un asset partagé (`asset_id` renseigné) + overrides
--         d'instance (visible, opacity, position_offset, z_index).
--
-- Bookeeping cross-plan : quand on édite un calque référencé depuis une scène,
-- les modifications sont poussées dans `layer_assets` et donc répercutées
-- automatiquement partout. Le bouton "Détacher" côté UI clone l'asset en inline
-- pour éditer localement sans impact.

-- ── Table bibliothèque des calques réutilisables ────────────────────────

CREATE TABLE IF NOT EXISTS layer_assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id     UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Calque',
  -- Type de média porté par le calque.
  -- 'composition' : scène composée (NPCs/items/choix) à baker.
  -- 'image' / 'video' / 'gif' : média direct (URL).
  type        TEXT NOT NULL DEFAULT 'composition'
                CHECK (type IN ('composition', 'image', 'video', 'gif')),
  -- Composition du calque (null pour les calques media direct).
  -- Stocke {npcs[], items[], choices[]?, conversations[]?} avec _uid stables.
  composition JSONB,
  -- URL du média direct OU URL du baked/rendu de la composition.
  media_url   TEXT,
  baked_url   TEXT,
  -- Métadonnées de génération (style/format/modèle/prompt) pour pouvoir re-baker.
  bake_meta   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layer_assets_book_id ON layer_assets(book_id);
CREATE INDEX IF NOT EXISTS idx_layer_assets_type ON layer_assets(book_id, type);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_layer_assets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_layer_assets_updated_at ON layer_assets;
CREATE TRIGGER trg_layer_assets_updated_at
  BEFORE UPDATE ON layer_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_layer_assets_updated_at();

-- ── Stacks de calques dans les entités existantes ──────────────────────

-- Ajout de plan_layers à `sections`. Le champ contient un array JSONB 2D :
-- [planIdx][layerIdx] → layer object.
-- Format de chaque layer :
--   {
--     "_uid": "local-uuid",
--     "asset_id": "uuid-in-layer_assets" | null,  -- null = inline
--     "name": "Nom affiché",
--     "type": "composition" | "image" | "video" | "gif",
--     "composition": {...} | null,  -- présent si inline ou override
--     "media_url": "...",
--     "baked_url": "...",
--     "bake_meta": {...},
--     "visible": true,
--     "opacity": 1,
--     "blend": "normal",
--     "position_offset": {"x": 0, "y": 0}
--   }
ALTER TABLE sections
  ADD COLUMN IF NOT EXISTS plan_layers JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Ajout des stacks pour transition et retour sur `choices`
ALTER TABLE choices
  ADD COLUMN IF NOT EXISTS transition_layers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS return_layers     JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Commentaires pour la doc PostgreSQL
COMMENT ON TABLE  layer_assets IS 'Bibliothèque de calques réutilisables entre plans/transitions/retours (Image Editor).';
COMMENT ON COLUMN layer_assets.type IS 'Type de média : composition (scène à baker) ou media direct (image/video/gif).';
COMMENT ON COLUMN layer_assets.composition IS 'Scène : {npcs, items, choices?, conversations?}. Null pour media direct.';
COMMENT ON COLUMN layer_assets.baked_url IS 'URL du rendu final (après bake IA pour composition, ou = media_url pour direct).';
COMMENT ON COLUMN layer_assets.bake_meta IS 'Métadonnées génération (style/format/checkpoint/prompt) pour re-baking.';

COMMENT ON COLUMN sections.plan_layers IS 'Stacks de calques par plan : [plan_idx][layer_idx]. Voir types.ts EditorLayer.';
COMMENT ON COLUMN choices.transition_layers IS 'Stack de calques de la transition de ce choix.';
COMMENT ON COLUMN choices.return_layers IS 'Stack de calques du retour de ce choix.';

-- ── RLS : les calques suivent la règle du livre parent ──────────────────
-- Note : activer RLS selon vos règles existantes sur books. Skip si pas de RLS.
-- ALTER TABLE layer_assets ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "layer_assets_select" ON layer_assets FOR SELECT
--   USING (EXISTS (SELECT 1 FROM books WHERE books.id = layer_assets.book_id));
-- CREATE POLICY "layer_assets_all"    ON layer_assets FOR ALL
--   USING (EXISTS (SELECT 1 FROM books WHERE books.id = layer_assets.book_id));
