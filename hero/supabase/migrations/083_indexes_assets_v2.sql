-- Migration 083 — Index Postgres pour la banque d'assets V2 (2026-05-13)
--
-- Complète la migration 082_assets_bank_v2.sql en ajoutant tous les index
-- nécessaires aux patterns d'accès du Studio Hero.
--
-- Méthodologie : index dérivés des WHERE / ORDER BY / JOIN observés dans :
--   - src/app/editor-test/studio-section/page.tsx
--   - src/components/studio-section/SectionTimelineEditor.tsx
--   - src/app/editor-test/animation-studio/AnimationStudioInner.tsx
--   - src/app/editor-test/animation-studio/components/multi-track-timeline/MultiTrackEditor.tsx
--   - src/app/editor-test/new-layout/page.tsx (Designer)
--   - src/components/studio-creator/SectionPlansPanel.tsx
--   - AUDIT-2026-05-13.md (patterns auto-save, library refresh, delete cascade)
--
-- Notes de design :
--   - Index composites : colonne la plus selective d'abord (ex: book_id avant
--     section_id parce qu'un livre a beaucoup de sections mais 1 user n'ouvre
--     qu'1 livre à la fois → book_id = très selective).
--   - Pas d'index single-column quand un composite préfixé existe (Postgres
--     peut utiliser le préfixe d'un index composite pour WHERE x = ?).
--   - GIN obligatoire pour array (character_ids) et jsonb (shots, overrides,
--     audio_tracks) si on veut filtrer dessus efficacement (operator @>, ?, ?&).
--   - Partial indexes pour réduire la taille quand un filtre constant est
--     courant (ex: WHERE video_url IS NOT NULL pour la library Animations).
--
-- Volumétrie cible (estimation) :
--   - 1000 sections × 20 assets/section = 20 000 rows section_timeline
--   - ~20 000 assets (image/animation/audio/text confondus)
--   - ~30 000 rows asset_usage (un asset peut être référencé par 1.5 livre en moy)
--   Toutes les query principales restent O(log n) avec ces index B-tree, et
--   pour les GIN sur arrays ~O(k log n) avec k = nb d'éléments matched.

BEGIN;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  asset_usage — Index des refs cross-livres                             ║
-- ╚════════════════════════════════════════════════════════════════════════╝
--
-- Cette table est la PLUS SOLLICITÉE — elle drive le filtre library Studio.
-- Patterns d'accès :
--   (1) Library "ne montre que les assets de ce livre" :
--       SELECT asset_id FROM asset_usage WHERE book_id = $1 AND asset_type = $2
--   (2) Filtre library par section + book (auto-save Studio Section) :
--       SELECT asset_id FROM asset_usage WHERE book_id = $1 AND section_id = $2
--   (3) Counting refs avant DELETE d'un asset (cleanup orphans, cf B.3/B.7) :
--       SELECT COUNT(*) FROM asset_usage WHERE asset_type = $1 AND asset_id = $2
--   (4) Lookup inverse : "où est utilisé cet asset ?" (cas H.10 — partage
--       cross-pellicules d'un audio uploadé) :
--       SELECT book_id, section_id FROM asset_usage WHERE asset_id = $1
--   (5) CASCADE delete via FK ON DELETE CASCADE (book_id) — Postgres a besoin
--       d'un index sur book_id pour scaler la cascade.

-- (1) + (5) — Library par-livre filtrée par type. book_id 1er car le user
-- n'ouvre qu'un livre à la fois donc très selective ; asset_type ensuite
-- car 4 valeurs distinctes uniquement.
CREATE INDEX IF NOT EXISTS idx_asset_usage_book_type
  ON public.asset_usage (book_id, asset_type);

-- (2) — Library scopée par-section (utilisée par sectionBankImages et le
-- folder Images du MultiTrackEditor cf AUDIT A.1). section_id seul peut être
-- NULL (asset orphelin de section → uploaded externally), partial pour skip.
CREATE INDEX IF NOT EXISTS idx_asset_usage_book_section
  ON public.asset_usage (book_id, section_id)
  WHERE section_id IS NOT NULL;

-- (3) + (4) — Lookup par (asset_type, asset_id) pour comptage refs et reverse.
-- Sert au cleanup orphan storage (cf AUDIT B.7) et au check "this asset is
-- used in N pellicules" avant suppression library (AUDIT H.9).
-- L'unicité (asset_type, asset_id, book_id, section_id) de 082 crée déjà un
-- index implicite avec cet ordre — mais on en ajoute un dédié pour les
-- requêtes qui filtrent UNIQUEMENT sur (asset_type, asset_id) sans book_id,
-- car le préfixe de l'index UNIQUE est asset_type qui est trop peu selective.
CREATE INDEX IF NOT EXISTS idx_asset_usage_asset_lookup
  ON public.asset_usage (asset_id, asset_type);


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  section_timeline — Timeline ordonnée par section                       ║
-- ╚════════════════════════════════════════════════════════════════════════╝
--
-- C'est la table la plus lue lors de l'affichage Studio Section / Animation
-- Studio : à chaque ouverture d'une section, on charge sa timeline complète.
-- Patterns d'accès :
--   (6) Affichage timeline d'une section (le pattern #1 de l'app) :
--       SELECT * FROM section_timeline
--         WHERE section_id = $1 ORDER BY position_idx
--   (7) Reverse lookup : "où est utilisé cet asset sur les timelines ?"
--       (cf check refs avant delete, AUDIT B.3) :
--       SELECT section_id FROM section_timeline
--         WHERE asset_type = $1 AND asset_id = $2
--   (8) Filtre par piste (ex: rendre seulement la piste audio d'une section
--       pour preview, cf AnimationStudioPreview) :
--       SELECT * FROM section_timeline
--         WHERE section_id = $1 AND track = $2 ORDER BY position_idx
--   (9) Unicité de position : pas de 2 blocs au même (section, track, pos)
--       (intégrité plus que perf — empêche les bugs de doublon timeline).

-- (6) + (8) — Index principal de la timeline. section_id 1er (très selective),
-- puis track (4 valeurs), puis position_idx pour l'ORDER BY. La présence
-- de position_idx dans l'index permet à Postgres de faire un index-only scan
-- pour le ORDER BY sans tri post-filtre.
CREATE INDEX IF NOT EXISTS idx_section_timeline_section_track_pos
  ON public.section_timeline (section_id, track, position_idx);

-- (7) — Lookup inverse asset → timeline. Sert au check refs avant delete
-- d'un asset depuis la banque (= "cet asset est utilisé dans N timelines").
CREATE INDEX IF NOT EXISTS idx_section_timeline_asset_lookup
  ON public.section_timeline (asset_type, asset_id);

-- (9) — Unicité sur (section_id, track, position_idx). Empêche les doublons
-- de position causés par les races auto-save (cf AUDIT B.5/H.1). Sert aussi
-- de scan pour ORDER BY si la query ne filtre pas par track.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_section_timeline_position
  ON public.section_timeline (section_id, track, position_idx);

-- Note : pas d'index sur (section_id) seul — couvert par le préfixe des
-- 2 index ci-dessus. Pas non plus d'index sur position_idx seul (sans contexte
-- section_id, position_idx n'a aucune sens).


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  assets_image — Banque d'images                                         ║
-- ╚════════════════════════════════════════════════════════════════════════╝
--
-- Les assets sont rarement query sans passer par asset_usage (qui scope par
-- livre). Donc peu d'index nécessaires hors PK. Sauf pour :
--   (10) Tri/affichage library par date de création (les + récents en haut,
--        comme dans MultiTrackEditor.handleSfxAdded qui prepend) :
--        SELECT * FROM assets_image WHERE id = ANY($1) ORDER BY created_at DESC
--   (11) Filtre par style (Phase 3b recherche library Designer) :
--        WHERE style = 'realistic'
--   (12) Filtre par source_type ('upload' vs 'generated' vs 'extracted')

-- (10) — Tri par created_at. Mais le filtre principal vient d'un IN (...) de
-- l'asset_usage, donc PK suffit pour le lookup et Postgres trie en mémoire.
-- À monitorer : si > 10k assets dans 1 livre on ajoutera un index ; pour V1
-- inutile.

-- (11) + (12) — Partial indexes uniquement si la cardinalité d'un filtre
-- devient un problème. Pour V1 (< 20k assets total), on skip.

-- → Aucun index nécessaire en V1 sur assets_image. (PK couvre les lookups
--   par id provenant de asset_usage / section_timeline.)


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  assets_animation — Banque de pellicules                                ║
-- ╚════════════════════════════════════════════════════════════════════════╝
--
-- Patterns d'accès :
--   (13) Library Animations filtrée par "vidéo déjà générée" (cf
--        MultiTrackEditor.libraryAnimations filter p.videoUrl != null) :
--        SELECT * FROM assets_animation WHERE video_url IS NOT NULL
--          AND id = ANY($1)
--   (14) Recherche pellicules par perso featured (Phase 3b — cross-section
--        reuse, project_image_bank_hierarchy.md) :
--        SELECT * FROM assets_animation WHERE character_ids @> ARRAY[$1]
--   (15) Filtre par type ('animation' vs 'image_static' vs 'conversation') :
--        WHERE type = $1
--   (16) Recherche full-text sur scene_visible / characters_appearance
--        (futur — pas V1).

-- (13) — Partial index pour la library : "afficher seulement les pellicules
-- avec video_url" (les drafts sans vidéo sont filtrés). Très selective :
-- au moment du chargement initial d'une section, 80% des pellicules ont
-- video_url. Mais le partial évite d'indexer les drafts.
CREATE INDEX IF NOT EXISTS idx_assets_animation_with_video
  ON public.assets_animation (id)
  WHERE video_url IS NOT NULL;

-- (14) — GIN sur character_ids text[] pour query @> et && (overlap). Drive
-- la recherche "anims où apparaît tel perso" (Phase 3b Designer + check
-- réf perso avant DELETE — cf AUDIT H.9 drawer persos).
CREATE INDEX IF NOT EXISTS idx_assets_animation_character_ids_gin
  ON public.assets_animation USING GIN (character_ids);

-- (15) — B-tree sur type pour distinguer animation vs image_static vs
-- conversation. Cardinalité faible (3 valeurs) donc partiel n'a pas de sens ;
-- mais utile dans les jointures library.
CREATE INDEX IF NOT EXISTS idx_assets_animation_type
  ON public.assets_animation (type);

-- Note GIN sur shots jsonb : pas activé en V1 — pas de query qui filtre sur
-- des clés JSONB internes (les shots sont lus en bloc lors du fetch d'une
-- pellicule, pas filtrés par sous-champs). Si Phase 3 ajoute "recherche par
-- shot.cameraMovement" on l'ajoutera : `USING GIN (shots jsonb_path_ops)`.


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  assets_audio — Banque audio (SFX + musique)                            ║
-- ╚════════════════════════════════════════════════════════════════════════╝
--
-- Patterns d'accès :
--   (17) Library Sounds : "SFX du livre courant" — cf MultiTrackEditor au
--        mount qui fetch /api/books/[id]/audio-bank :
--        SELECT a.* FROM assets_audio a
--          JOIN asset_usage u ON u.asset_id = a.id AND u.asset_type='audio'
--          WHERE u.book_id = $1 AND a.kind = $2
--          ORDER BY a.created_at DESC
--   (18) Pas de filtre kind sans book_id (l'auteur ne voit jamais TOUS les
--        SFX de TOUTE la plateforme).

-- (17) — Le JOIN asset_usage utilise idx_asset_usage_book_type. Le SELECT
-- sur a.id se fait via PK. Reste à indexer kind pour le WHERE additionnel :
CREATE INDEX IF NOT EXISTS idx_assets_audio_kind
  ON public.assets_audio (kind);

-- Tri created_at DESC : pour les listes "les plus récents en haut" si le
-- volume devient gros. Skip en V1.


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  assets_text — Banque de textes overlay                                 ║
-- ╚════════════════════════════════════════════════════════════════════════╝
--
-- Les overlays texte sont (a) peu nombreux par livre (< 50 typiquement) et
-- (b) toujours fetchés en bloc via asset_usage. Donc PK + scan suffit.
--
-- → Aucun index supplémentaire nécessaire en V1.


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  COMMENTAIRES — index documentés                                        ║
-- ╚════════════════════════════════════════════════════════════════════════╝

COMMENT ON INDEX public.idx_asset_usage_book_type IS
  'Library Studio scopée par-livre : filtre principal des banques (image/animation/audio/text).';
COMMENT ON INDEX public.idx_asset_usage_book_section IS
  'Library scopée par section (sectionBankImages, folder Images Studio Section). Partial : skip rows orphan section.';
COMMENT ON INDEX public.idx_asset_usage_asset_lookup IS
  'Reverse lookup : où est utilisé cet asset ? Sert cleanup orphans + check refs avant DELETE.';
COMMENT ON INDEX public.idx_section_timeline_section_track_pos IS
  'Affichage timeline d''une section : SELECT WHERE section_id = ? ORDER BY position_idx. Couvre aussi filtre par piste.';
COMMENT ON INDEX public.idx_section_timeline_asset_lookup IS
  'Reverse lookup : sur quelles timelines cet asset apparaît ? Sert check refs avant DELETE asset bank.';
COMMENT ON INDEX public.uniq_section_timeline_position IS
  'Unicité (section, track, position) : empêche les doublons causés par races auto-save (AUDIT B.5/H.1).';
COMMENT ON INDEX public.idx_assets_animation_with_video IS
  'Partial index pour library Animations (filter videoUrl != null cf MultiTrackEditor.libraryAnimations).';
COMMENT ON INDEX public.idx_assets_animation_character_ids_gin IS
  'GIN sur character_ids[] : recherche par perso featured + check refs avant DELETE perso (AUDIT H.9).';
COMMENT ON INDEX public.idx_assets_animation_type IS
  'Distinction animation / image_static / conversation pour rendering library.';
COMMENT ON INDEX public.idx_assets_audio_kind IS
  'Distinction sfx / music dans library Audio (cf /api/books/[id]/audio-bank).';

COMMIT;
