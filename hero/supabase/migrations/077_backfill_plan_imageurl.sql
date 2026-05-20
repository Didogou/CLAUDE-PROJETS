-- Migration 077 : back-fill plans.data.imageUrl depuis section.images legacy
--
-- Cf. décision design 2026-05-06 (option β) : on copie l'image legacy de la
-- section vers le nouveau modèle Plan pour que la thumb apparaisse dans le
-- Storyboard sans avoir à re-uploader manuellement.
--
-- Match positionnel : section.images[plan.sort_order].url → plan.data.imageUrl
-- Idempotent (WHERE clause skip les plans déjà renseignés).

UPDATE plans p
SET data = jsonb_set(
  COALESCE(p.data, '{}'::jsonb),
  '{imageUrl}',
  to_jsonb(s.images->p.sort_order->>'url')
)
FROM sections s
WHERE p.section_id = s.id
  AND s.images IS NOT NULL
  AND jsonb_typeof(s.images) = 'array'
  AND jsonb_array_length(s.images) > p.sort_order
  AND s.images->p.sort_order->>'url' IS NOT NULL
  AND s.images->p.sort_order->>'url' != ''
  AND (p.data->>'imageUrl' IS NULL OR p.data->>'imageUrl' = '');

-- Vérification (optionnel) : combien de plans ont été back-fillés ?
-- SELECT COUNT(*) FROM plans WHERE data->>'imageUrl' IS NOT NULL;
