-- ── text_sequence sur section_images ─────────────────────────────────────────
-- Remplace/complète le champ thought (legacy conservé pour fallback)
-- Structure : [{ type: 'narrative'|'thought', text: '...' }, ...]

alter table sections
  alter column images
  set default '[]'::jsonb;

-- text_sequence est stocké dans le jsonb images[] sur chaque image
-- Pas de colonne séparée : text_sequence est un champ du jsonb SectionImage
-- (images est déjà jsonb sur sections, pas de migration colonne nécessaire)

-- ── discussion_scene sur sections ────────────────────────────────────────────
-- Structure : { npc_id, npc_opening, npc_opening_audio_url?, choices: [...] }

alter table sections
  add column if not exists discussion_scene jsonb default null;

comment on column sections.discussion_scene is
  'Scène de discussion sur la dernière image : { npc_id, npc_opening, npc_opening_audio_url?, choices: [{ id, player_text, emotion_icon, emotion_label, npc_response, npc_response_audio_url?, section_choice_id }] }';
