-- 025 : address_form (tutoiement/vouvoiement) + synopsis de rédaction

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS address_form text DEFAULT 'vous' CHECK (address_form IN ('tu', 'vous')),
  ADD COLUMN IF NOT EXISTS synopsis     text DEFAULT NULL;
