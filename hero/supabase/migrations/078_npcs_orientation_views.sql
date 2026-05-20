-- Migration : vues d'orientation supplémentaires pour les NPCs.
--
-- Contexte (refonte 2026-05-09 — option B "multi-vues per character") : la
-- migration 071 avait ajouté 4 vues (portrait/portrait_scenic/fullbody_gray/
-- fullbody_scenic) MAIS toutes en cadrage vue de face. Pour permettre le
-- placement réaliste de persos dans une scène (ex: Roman tourné vers le
-- panier), on a besoin de vues sous différents angles.
--
-- Les nouvelles vues sont générées via Qwen Image Edit + multi-angles LoRA
-- (cf /api/comfyui/qwen-travelling), à partir du fullbody_gray_url existant.
-- Toutes nullable : un NPC peut n'avoir que la vue de face si l'auteur n'a
-- pas généré les autres.
--
-- Étape 1 (validation Qwen) : on commence par la vue dos. Si la qualité tient,
-- on ajoutera profil L/R en étape 2 sans nouvelle migration (déjà fait ici
-- pour éviter une 2e migration plus tard).

ALTER TABLE npcs
  ADD COLUMN IF NOT EXISTS fullbody_back_url          text,
  ADD COLUMN IF NOT EXISTS fullbody_profile_left_url  text,
  ADD COLUMN IF NOT EXISTS fullbody_profile_right_url text;

COMMENT ON COLUMN npcs.fullbody_back_url          IS 'Plein-pied vue de DOS sur fond gris #808080 (Qwen multi-angle 180°). Optionnel.';
COMMENT ON COLUMN npcs.fullbody_profile_left_url  IS 'Plein-pied vue de PROFIL GAUCHE sur fond gris (Qwen multi-angle -90°). Optionnel.';
COMMENT ON COLUMN npcs.fullbody_profile_right_url IS 'Plein-pied vue de PROFIL DROIT sur fond gris (Qwen multi-angle +90°). Optionnel.';
