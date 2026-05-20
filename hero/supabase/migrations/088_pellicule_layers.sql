-- Migration 088 — Calques runtime par pellicule (2026-05-18)
--
-- Phase A du chantier "Activer Option C+ runtime + Keyframes".
-- Active enfin le rendu runtime des calques au-dessus des pellicules, gap
-- documenté depuis 2026-04-24 (cf memory project_hero_runtime_gap).
--
-- Avant : plan_layers[plan_idx][] sur sections (legacy, indexé par plan_idx).
--         Écrits par le Designer, jamais lus au runtime.
--
-- Après : table relationnelle pellicule_layers (1 row = 1 calque), FK directe
--         vers section_timeline.id (= la pellicule à laquelle le calque est
--         attaché). Cascade DELETE : supprimer une pellicule retire ses calques.
--
-- Scope V1 (Phase A) :
--   - Types : 'image' | 'video' | 'gif'
--   - Props : position (x/y %), scale, rotation, opacity, blend, z_index
--   - Mask : rect ou polygon (stocké en JSONB)
--   - Effets visuels : glow / shadow / blur (stockés en JSONB)
--
-- Évolutivité prévue (Phase B+) :
--   - Ajouter types 'weather' | 'composition' | 'animation' (champ params JSONB)
--   - Ajouter keyframes (table séparée pellicule_layer_keyframes ou JSONB ici)

BEGIN;

-- ── Table principale ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pellicule_layers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pellicule_id    uuid NOT NULL REFERENCES public.section_timeline(id) ON DELETE CASCADE,

  -- Type extensible. V1 = 'image' | 'video' | 'gif'. Futur : weather,
  -- composition, animation. CHECK relâché plus tard via ALTER TABLE.
  type            text NOT NULL,

  -- URL Supabase Storage du média (PNG/JPG/MP4/GIF). Pour les types futurs
  -- sans média direct (weather, composition), peut être null.
  media_url       text,

  -- ── Transform (en % du canvas pellicule) ──────────────────────────────
  -- position_x/y : 0 = bord gauche/haut, 50 = centre, 100 = bord droit/bas.
  -- Le calque est ancré par son CENTRE pour faciliter scale/rotation.
  position_x      numeric NOT NULL DEFAULT 50,
  position_y      numeric NOT NULL DEFAULT 50,
  scale           numeric NOT NULL DEFAULT 1.0,
  rotation        numeric NOT NULL DEFAULT 0,    -- degrés, -180 → 180
  opacity         numeric NOT NULL DEFAULT 1.0,  -- 0 → 1

  -- CSS mix-blend-mode. 'normal' par défaut, extensible via SELECT en UI.
  blend           text NOT NULL DEFAULT 'normal',

  -- Ordre de stacking. Plus haut = au-dessus visuellement.
  z_index         integer NOT NULL DEFAULT 0,

  -- Toggle visibilité (sans supprimer le row).
  visible         boolean NOT NULL DEFAULT true,

  -- ── Mask (Phase A) ─────────────────────────────────────────────────────
  -- Format : { shape: 'rect' | 'polygon', points: [[x, y], ...] }
  -- points en % du canvas pellicule. Rectangle = 4 points dans l'ordre TL/TR/BR/BL.
  -- Polygon = N points (≥3). Utilisé pour clip-path CSS au runtime.
  mask            jsonb,

  -- ── Effets visuels (Phase A) ───────────────────────────────────────────
  -- Format :
  --   { glow:   { color: '#fff', intensity: 0.6, spread: 16 },
  --     shadow: { color: '#000', intensity: 0.7, offsetX: 2, offsetY: 4, blur: 8 },
  --     blur:   { amount: 0 } }
  -- Appliqué via CSS filter: drop-shadow / blur au runtime.
  effects         jsonb,

  -- ── Config spécifique au type (extensible) ─────────────────────────────
  -- Sert pour les futurs types : weather (density, intensity, color), composition
  -- (NPC ids, item placements), animation (kind, mask, params). En V1 (image/
  -- video/gif), peut rester null.
  params          jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pellicule_layers_type_check CHECK (type IN ('image', 'video', 'gif')),
  CONSTRAINT pellicule_layers_opacity_check CHECK (opacity >= 0 AND opacity <= 1),
  CONSTRAINT pellicule_layers_scale_check CHECK (scale > 0)
);

COMMENT ON TABLE public.pellicule_layers IS
  'Calques visuels (image/video/gif + mask + effets) posés au-dessus d''une pellicule. '
  'Rendus au runtime par PelliculeRenderer. Chaque row = 1 calque, lié à 1 pellicule '
  'via pellicule_id (FK section_timeline.id, cascade delete). Phase A du chantier '
  'runtime layers (cf memory project_hero_runtime_gap).';

COMMENT ON COLUMN public.pellicule_layers.position_x IS 'Position centrale X en % du canvas pellicule (0=gauche, 50=centre, 100=droite)';
COMMENT ON COLUMN public.pellicule_layers.position_y IS 'Position centrale Y en % du canvas pellicule (0=haut, 50=centre, 100=bas)';
COMMENT ON COLUMN public.pellicule_layers.mask IS 'Mask clip-path : { shape: ''rect''|''polygon'', points: [[x,y]..] en %% canvas }';
COMMENT ON COLUMN public.pellicule_layers.effects IS 'Effets visuels CSS : { glow: {color, intensity, spread}, shadow: {color, offsetX, offsetY, blur, intensity}, blur: {amount} }';

-- ── Index ────────────────────────────────────────────────────────────────
-- Lecture principale = "tous les calques de cette pellicule, ordonnés".
CREATE INDEX IF NOT EXISTS idx_pellicule_layers_pellicule_z
  ON public.pellicule_layers (pellicule_id, z_index ASC);

-- ── Trigger updated_at (réutilise la fonction touch_updated_at de 082) ──
CREATE TRIGGER trg_pellicule_layers_updated
  BEFORE UPDATE ON public.pellicule_layers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
