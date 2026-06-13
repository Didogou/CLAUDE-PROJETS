-- =============================================================
-- Bucket `recipe-audio` : voix ElevenLabs des étapes de préparation.
-- =============================================================
-- Le bucket `content-images` restreint les MIME aux images et rejette
-- l'audio (mime type audio/mpeg is not supported). On utilise donc un
-- bucket dédié, PUBLIC (lecture via URL publique), qui autorise l'audio.
--
-- Upload = service role (admin) → bypass RLS. Lecture = endpoint public
-- (bucket public) → aucune policy supplémentaire nécessaire.

insert into storage.buckets (id, name, public, allowed_mime_types)
values ('recipe-audio', 'recipe-audio', true, array['audio/mpeg', 'audio/mp3'])
on conflict (id) do update
  set public = true,
      allowed_mime_types = array['audio/mpeg', 'audio/mp3'];
