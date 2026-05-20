-- Migration 080 : autoriser le type 'choice' sur la table plans.
-- Refonte 2026-05-11 Step 3 — Plan choix (écran décisionnel livre-jeu).
--
-- Étend la CHECK constraint définie en 075_plans.sql pour inclure 'choice'
-- en plus des 3 types existants. Pas de migration de données, c'est juste
-- l'ouverture d'une 4e valeur autorisée.

ALTER TABLE plans
  DROP CONSTRAINT IF EXISTS plans_type_check;

ALTER TABLE plans
  ADD CONSTRAINT plans_type_check
  CHECK (type IN ('static', 'animation', 'conversation', 'choice'));

-- Commentaire pour traçabilité
COMMENT ON COLUMN plans.type IS
  'Type de Plan : static (image fixe), animation (vidéo LTX/Wan), conversation (dialogue NPC), choice (écran de choix interactif - refonte 2026-05-11).';
