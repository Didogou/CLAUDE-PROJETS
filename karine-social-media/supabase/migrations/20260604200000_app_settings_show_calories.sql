-- =============================================================
-- Toggle global : afficher les kcal/100g dans la sheet calorie cote
-- abonnee.
--
-- Si OFF, Karine veut que l UI cache :
--  - les '130 kcal · 30g/portion' sur l item selectionne
--  - les 'X kcal/100g' sur chaque candidat de la liste
--
-- Le compteur kcal principal (en haut de la sheet) reste affiche
-- — ce toggle vise specifiquement le bruit dans la liste des
-- candidats Ciqual.
-- =============================================================

alter table public.app_settings
  add column if not exists show_calories_in_counter boolean not null default true;

comment on column public.app_settings.show_calories_in_counter is
  'Si false, masque les kcal/100g dans la sheet calorie cote abonnee (mode focus aliments, anti-stress chiffres).';
