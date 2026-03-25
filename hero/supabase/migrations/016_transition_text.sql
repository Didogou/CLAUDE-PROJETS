-- Ajoute le texte de transition par défaut pour chaque choix
-- Ce texte est affiché dans le lecteur juste avant le contenu de la section cible,
-- pour contextualiser la navigation en fonction de la section source.

ALTER TABLE choices ADD COLUMN IF NOT EXISTS transition_text text;
