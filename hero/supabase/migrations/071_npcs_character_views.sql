-- Migration : 4 vues d'un personnage (matrice cadrage × fond) sur la table npcs.
--
-- Contexte : le sous-wizard "Extraire en fiche" (PlanWizard) génère pour
-- chaque NPC une matrice 2×2 d'images :
--   - Portrait fond gris       → portrait_url (déjà présent, IPAdapter FaceID + fiche compacte)
--   - Portrait avec background → portrait_scenic_url (NOUVEAU, carte joueur immersive)
--   - Plein-pied fond gris     → fullbody_gray_url (NOUVEAU, IPAdapter ref forte + fiche complète)
--   - Plein-pied avec backgrnd → fullbody_scenic_url (NOUVEAU, image directe pour un plan)
--
-- Toutes nullable : un NPC peut être créé avec seulement le portrait gris,
-- les autres se remplissent au fur et à mesure des extractions.

ALTER TABLE npcs
  ADD COLUMN IF NOT EXISTS portrait_scenic_url   text,
  ADD COLUMN IF NOT EXISTS fullbody_gray_url     text,
  ADD COLUMN IF NOT EXISTS fullbody_scenic_url   text;

COMMENT ON COLUMN npcs.portrait_scenic_url IS 'Portrait du NPC avec background contextuel (carte joueur immersive). Optionnel.';
COMMENT ON COLUMN npcs.fullbody_gray_url   IS 'Plein-pied fond gris #808080 (référence IPAdapter forte + fiche complète). Optionnel.';
COMMENT ON COLUMN npcs.fullbody_scenic_url IS 'Plein-pied avec background contextuel (image directe pour un plan). Optionnel.';
