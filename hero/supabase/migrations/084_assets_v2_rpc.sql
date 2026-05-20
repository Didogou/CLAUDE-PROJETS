-- Migration 084 — RPC atomiques pour la banque V2 (audit V3 #1, #2, cleanup)
--
-- Contexte : la banque V2 (082) utilise des FK logiques pour asset_id (4 tables
-- assets_image/animation/audio/text). Pour garantir la cohérence des opérations
-- DELETE on encapsule la cascade dans 3 RPC plpgsql exécutées en transaction
-- atomique côté DB (au lieu de 3 requêtes Supabase JS séparées qui peuvent
-- partial-fail et laisser des orphelins).
--
-- Sémantique de scoping :
--   - delete_asset_scoped(type, id, book_id) → "retire de MON livre uniquement"
--     • supprime asset_usage(type, id, book_id, *)
--     • supprime section_timeline(type, id, ∀ section ∈ book_id)
--     • SI plus aucune asset_usage pour (type, id) → DELETE de la row asset
--       (= libération storage). Sinon l'asset reste réutilisable par d'autres
--       livres qui le référencent encore.
--
--   - delete_asset_global(type, id) → "supprime partout, tous les livres"
--     • cascade total : asset_usage + section_timeline + asset row
--
--   - cleanup_orphan_assets(min_age_minutes) → cron nightly job
--     • supprime les rows assets_<type> qui n'ont AUCUNE asset_usage AND ont
--       été créées il y a plus de min_age_minutes (évite race condition avec
--       drafts en cours de commit lazy-create — voir lazy_create_asset_pattern)

BEGIN;

-- ── delete_asset_scoped ─────────────────────────────────────────────────
-- Retire un asset du scope d'UN livre. Cascade automatique de l'asset row
-- si plus aucune référence après cleanup. Atomic.
CREATE OR REPLACE FUNCTION public.delete_asset_scoped(
  p_asset_type text,
  p_asset_id uuid,
  p_book_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_refs_remaining integer;
  v_asset_fully_deleted boolean := false;
  v_table text;
BEGIN
  IF p_asset_type NOT IN ('image', 'animation', 'audio', 'text') THEN
    RAISE EXCEPTION 'asset_type invalide : %', p_asset_type;
  END IF;
  v_table := 'assets_' || p_asset_type;

  -- 1. Supprime les usages dans CE livre uniquement
  DELETE FROM public.asset_usage
   WHERE asset_type = p_asset_type
     AND asset_id   = p_asset_id
     AND book_id    = p_book_id;

  -- 2. Supprime les blocs timeline dans les sections de CE livre
  DELETE FROM public.section_timeline
   WHERE asset_type = p_asset_type
     AND asset_id   = p_asset_id
     AND section_id IN (SELECT id FROM public.sections WHERE book_id = p_book_id);

  -- 3. Compte les références restantes (= autres livres qui référencent encore)
  SELECT count(*) INTO v_refs_remaining
    FROM public.asset_usage
   WHERE asset_type = p_asset_type
     AND asset_id   = p_asset_id;

  -- 4. Si zéro ref restante → libère l'asset row
  IF v_refs_remaining = 0 THEN
    EXECUTE format('DELETE FROM public.%I WHERE id = $1', v_table)
      USING p_asset_id;
    v_asset_fully_deleted := true;
  END IF;

  RETURN jsonb_build_object(
    'removed_from_book', true,
    'refs_remaining', v_refs_remaining,
    'asset_fully_deleted', v_asset_fully_deleted
  );
END;
$$;
COMMENT ON FUNCTION public.delete_asset_scoped IS
  'Retire un asset du scope d''UN livre (cascade asset row si plus aucune ref).';


-- ── delete_asset_global ─────────────────────────────────────────────────
-- Supprime un asset partout (tous les livres) en transaction atomique.
CREATE OR REPLACE FUNCTION public.delete_asset_global(
  p_asset_type text,
  p_asset_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_table text;
  v_usage_count integer;
  v_timeline_count integer;
BEGIN
  IF p_asset_type NOT IN ('image', 'animation', 'audio', 'text') THEN
    RAISE EXCEPTION 'asset_type invalide : %', p_asset_type;
  END IF;
  v_table := 'assets_' || p_asset_type;

  WITH del_timeline AS (
    DELETE FROM public.section_timeline
     WHERE asset_type = p_asset_type AND asset_id = p_asset_id
    RETURNING 1
  )
  SELECT count(*) INTO v_timeline_count FROM del_timeline;

  WITH del_usage AS (
    DELETE FROM public.asset_usage
     WHERE asset_type = p_asset_type AND asset_id = p_asset_id
    RETURNING 1
  )
  SELECT count(*) INTO v_usage_count FROM del_usage;

  EXECUTE format('DELETE FROM public.%I WHERE id = $1', v_table)
    USING p_asset_id;

  RETURN jsonb_build_object(
    'asset_fully_deleted', true,
    'usage_rows_deleted', v_usage_count,
    'timeline_rows_deleted', v_timeline_count
  );
END;
$$;
COMMENT ON FUNCTION public.delete_asset_global IS
  'Supprime un asset partout (cascade asset_usage + section_timeline + asset row).';


-- ── cleanup_orphan_assets ───────────────────────────────────────────────
-- Job nightly : supprime les assets sans aucune asset_usage. Garde un délai
-- min_age_minutes (défaut 60) pour éviter de tuer les drafts en cours de
-- commit (lazy-create : POST asset puis POST timeline non-atomique en V2 ;
-- l'asset existe brièvement sans usage entre les 2 calls → on attend pour
-- ne pas supprimer accidentellement).
CREATE OR REPLACE FUNCTION public.cleanup_orphan_assets(
  p_min_age_minutes integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted_image integer;
  v_deleted_animation integer;
  v_deleted_audio integer;
  v_deleted_text integer;
  v_cutoff timestamptz := now() - (p_min_age_minutes || ' minutes')::interval;
BEGIN
  WITH d AS (
    DELETE FROM public.assets_image a
     WHERE a.created_at < v_cutoff
       AND NOT EXISTS (
         SELECT 1 FROM public.asset_usage u
          WHERE u.asset_type = 'image' AND u.asset_id = a.id
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_image FROM d;

  WITH d AS (
    DELETE FROM public.assets_animation a
     WHERE a.created_at < v_cutoff
       AND NOT EXISTS (
         SELECT 1 FROM public.asset_usage u
          WHERE u.asset_type = 'animation' AND u.asset_id = a.id
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_animation FROM d;

  WITH d AS (
    DELETE FROM public.assets_audio a
     WHERE a.created_at < v_cutoff
       AND NOT EXISTS (
         SELECT 1 FROM public.asset_usage u
          WHERE u.asset_type = 'audio' AND u.asset_id = a.id
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_audio FROM d;

  WITH d AS (
    DELETE FROM public.assets_text a
     WHERE a.created_at < v_cutoff
       AND NOT EXISTS (
         SELECT 1 FROM public.asset_usage u
          WHERE u.asset_type = 'text' AND u.asset_id = a.id
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_text FROM d;

  RETURN jsonb_build_object(
    'image', v_deleted_image,
    'animation', v_deleted_animation,
    'audio', v_deleted_audio,
    'text', v_deleted_text,
    'cutoff', v_cutoff
  );
END;
$$;
COMMENT ON FUNCTION public.cleanup_orphan_assets IS
  'Nightly cron : supprime assets_<type> sans asset_usage et créés > N minutes.';

COMMIT;
