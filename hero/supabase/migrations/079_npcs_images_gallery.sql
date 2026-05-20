-- Migration : galerie d'images par NPC (refonte 2026-05-09 — option B).
--
-- Contexte : les colonnes dédiées (portrait_url, fullbody_gray_url + 078 :
-- fullbody_back_url, fullbody_profile_left_url, fullbody_profile_right_url)
-- limitent le perso à 5 images max. L'auteur veut pouvoir stocker des
-- VARIANTES par scène (ex: Marvyn cheveux rouges pour la scène X) en plus
-- des vues canoniques. Modèle "5 slots fixes" → "galerie illimitée".
--
-- Architecture retenue (refonte 2026-05-09) :
--   - portrait_url + fullbody_gray_url RESTENT en colonnes dédiées : ce
--     sont les RÉFÉRENCES CANONIQUES utilisées par les pipelines downstream
--     (IPAdapter, FaceID, Kontext). Ne pas les noyer dans la galerie pour
--     éviter qu'un pipeline tire au hasard une variante au lieu de la réf.
--   - TOUT LE RESTE va dans `images` jsonb : vues alternatives (back,
--     profil G/D), variantes scéniques, uploads custom, extractions, etc.
--
-- Format chaque entrée :
--   { id: string, url: string, label: string, source?: string, kind?: string }
--   - id     : UUID local généré côté client (= clé pour edit/delete)
--   - url    : URL Supabase persistante (jamais blob URL)
--   - label  : nom affiché ("Vue de dos", "Cheveux rouges"…)
--   - source : 'qwen_multiangle' | 'upload' | 'extraction' | 'kontext_variant' (optionnel)
--   - kind   : 'view_back' | 'view_profile_left' | 'view_profile_right' | 'variant' | 'custom' (optionnel)
--
-- Les colonnes de la migration 078 (fullbody_back_url, fullbody_profile_*_url)
-- sont conservées pour back-compat, mais le code arrête de les écrire (= elles
-- vont devenir dormantes, à dropper dans une migration future après vérif).

ALTER TABLE npcs
  ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb NOT NULL;

COMMENT ON COLUMN npcs.images IS 'Galerie d''images additionnelles du perso (vues alternatives, variantes scéniques, uploads). Format : [{id, url, label, source?, kind?}]. Les 2 canoniques (portrait_url, fullbody_gray_url) restent en colonnes séparées pour les pipelines downstream (IPAdapter, FaceID, Kontext).';
