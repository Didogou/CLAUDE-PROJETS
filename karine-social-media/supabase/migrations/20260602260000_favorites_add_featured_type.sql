-- Ajoute le type 'featured' (Le saviez-vous) à la table favorites.
-- Le check constraint existant ne l'incluait pas, donc impossible d'insérer.

alter table public.favorites
  drop constraint if exists favorites_target_type_check;

alter table public.favorites
  add constraint favorites_target_type_check
  check (target_type in ('recipe', 'menu', 'tip', 'advice', 'featured'));
