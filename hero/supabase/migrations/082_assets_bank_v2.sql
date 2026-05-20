-- Migration 082 — Refonte V2 banque d'assets globale (2026-05-13)
--
-- Avant : section.images[] (JSONB) contenait TOUT (images, pellicules animation,
--         choix). Tableau ordonné inline dans chaque section. Aucune réutilisation
--         cross-section, aucune dédup, aucun index pour la recherche.
--
-- Après :
--   - Banque globale d'assets typés (images, animations, audio, text)
--   - Indexation cross-livres via asset_usage (asset_type, asset_id, book_id, section_id)
--   - Timeline de section = table de jointure ordonnée section_timeline qui pointe
--     vers les assets via (asset_type, asset_id).
--
-- Visibilité UX : par défaut l'auteur ne voit que les assets de son livre courant
-- (filtré via asset_usage.book_id). Fonction "Importer depuis un livre" crée une
-- nouvelle row asset_usage(book_id=current, asset_id=imported) sans dupliquer
-- l'asset lui-même.
--
-- Migration des données : voir script 083_migrate_section_images_jsonb.sql qui
-- décompose les section.images[] JSONB existants. Le JSONB original est CONSERVÉ
-- en backup tant que la migration n'est pas validée + l'UI bascule.

BEGIN;

-- ── Banque d'images ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assets_image (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,                          -- URL Supabase Storage (bucket images)
  label text,                                  -- nom convivial éditable
  description text,                            -- description textuelle (prompt_fr)
  prompt_fr text,                              -- prompt FR original
  prompt_en text,                              -- prompt EN traduit
  style text,                                  -- IllustrationStyle ('realistic', 'cartoon', ...)
  width integer,                               -- dimensions natives (utile UI)
  height integer,
  comfyui_settings jsonb,                      -- snapshot config ComfyUI au moment de la gen
  source_type text DEFAULT 'generated',        -- 'generated' | 'upload' | 'extracted'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
COMMENT ON TABLE public.assets_image IS
  'Banque d''images réutilisables cross-livres. Référencée via asset_usage.';

-- ── Banque d'animations (= pellicules vidéo) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.assets_animation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_url text,                              -- MP4 généré (null = draft non généré)
  first_frame_url text,                        -- première frame du MP4
  last_frame_url text,                         -- dernière frame du MP4
  label text,
  scene_visible text,                          -- description scène (Vantage format)
  scene_offscreen text,
  characters_appearance text,                  -- format Vantage multi-lignes
  character_ids text[] DEFAULT '{}',           -- IDs persos featured (max 2 IC LoRA Dual)
  shots jsonb DEFAULT '[]'::jsonb,             -- ShotPersisted[] inline (shots[].duration, shot, camera, perCharacter, sceneAction, ...)
  trim_start real,                             -- en secondes
  trim_end real,
  source text DEFAULT 'ltx',                   -- 'ltx' | 'upload'
  v2v_continue boolean DEFAULT false,
  exit_data jsonb,                             -- PelliculeExit { kind, options? }
  type text DEFAULT 'animation',               -- 'animation' | 'image_static' | 'conversation'
  audio_tracks jsonb DEFAULT '[]'::jsonb,      -- AudioTrackData[] (sfx + music sur cette pellicule)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
COMMENT ON TABLE public.assets_animation IS
  'Banque de pellicules animation. Chaque row = 1 vidéo générée ou en cours de gen.';

-- ── Banque audio (SFX + musique) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assets_audio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_url text NOT NULL,                     -- URL Supabase Storage (bucket audio)
  kind text NOT NULL,                          -- 'sfx' | 'music'
  label text,
  duration_sec real,                           -- durée en secondes
  source_type text DEFAULT 'generated',        -- 'generated' (ElevenLabs) | 'upload'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT assets_audio_kind_check CHECK (kind IN ('sfx', 'music'))
);

-- ── Banque texte overlay ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assets_text (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  template text DEFAULT 'fade',                -- 'fade' | 'typewriter' | 'slide_up'
  position text DEFAULT 'center',              -- 'top' | 'center' | 'bottom'
  size text DEFAULT 'lg',                      -- 'sm' | 'md' | 'lg' | 'xl'
  default_duration_sec real DEFAULT 3,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT assets_text_template_check CHECK (template IN ('fade', 'typewriter', 'slide_up')),
  CONSTRAINT assets_text_position_check CHECK (position IN ('top', 'center', 'bottom')),
  CONSTRAINT assets_text_size_check CHECK (size IN ('sm', 'md', 'lg', 'xl'))
);

-- ── Index des refs cross-livres ──────────────────────────────────────────
-- Track où chaque asset est utilisé (= 1 row par couple asset+section).
-- Drive le filtre library : "ne montre que les assets utilisés dans ce livre".
CREATE TABLE IF NOT EXISTS public.asset_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type text NOT NULL,                    -- 'image' | 'animation' | 'audio' | 'text'
  asset_id uuid NOT NULL,                      -- FK logique vers assets_<type>.id
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT asset_usage_type_check CHECK (asset_type IN ('image', 'animation', 'audio', 'text')),
  CONSTRAINT asset_usage_unique UNIQUE (asset_type, asset_id, book_id, section_id)
);
COMMENT ON TABLE public.asset_usage IS
  'Track quelles sections de quels livres référencent quels assets. '
  'Permet filtre library par livre + cleanup orphans par comptage de refs.';

-- ── Timeline de section ──────────────────────────────────────────────────
-- Table de jointure ordonnée. Chaque row = 1 bloc sur la timeline d'une section.
-- L'asset référencé reste dans sa banque (réutilisable) — supprimer un bloc
-- timeline ne supprime PAS l'asset.
CREATE TABLE IF NOT EXISTS public.section_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
  position_idx integer NOT NULL,               -- ordre du bloc dans la timeline (0-indexed)
  track text NOT NULL,                         -- 'video_image' | 'sfx' | 'music' | 'text'
  asset_type text NOT NULL,                    -- 'image' | 'animation' | 'audio' | 'text'
  asset_id uuid NOT NULL,                      -- FK logique vers assets_<type>.id
  start_ms integer NOT NULL DEFAULT 0,         -- début sur la timeline en ms
  duration_ms integer NOT NULL DEFAULT 3000,   -- durée affichée
  overrides jsonb,                             -- override per-block : volume, fadeIn/Out, textPosition spécifique, etc.
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT section_timeline_track_check CHECK (track IN ('video_image', 'sfx', 'music', 'text')),
  CONSTRAINT section_timeline_asset_type_check CHECK (asset_type IN ('image', 'animation', 'audio', 'text')),
  CONSTRAINT section_timeline_duration_check CHECK (duration_ms > 0)
);
COMMENT ON TABLE public.section_timeline IS
  'Table de jointure : ordre + placement des assets sur la timeline d''une section. '
  'Supprimer un row = retirer le bloc de la timeline (l''asset reste dans sa banque).';

-- ── Triggers updated_at ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assets_image_updated     BEFORE UPDATE ON public.assets_image
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_assets_animation_updated BEFORE UPDATE ON public.assets_animation
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_assets_audio_updated     BEFORE UPDATE ON public.assets_audio
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_assets_text_updated      BEFORE UPDATE ON public.assets_text
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_section_timeline_updated BEFORE UPDATE ON public.section_timeline
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
