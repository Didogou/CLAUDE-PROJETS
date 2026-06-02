-- Liste de courses structurée (extraite par Claude Vision depuis l'image
-- uploadée par l'admin). Permet le cochage côté user + multiplication par
-- nombre de personnes.
--
-- shopping_list_portions : nb de personnes pour lequel la liste est calibrée
-- shopping_list_items    : tableau d'items { category, label, quantity, unit }
--   - quantity : number | null   (null = pas de quantité, ex: "Sel, poivre")
--   - unit     : string | null   ('g', 'cl', 'ml', 'pers', 'cs', 'cc', etc.)
--   - category : string          ('Fruits & Légumes', 'Épicerie', ...)
--   - label    : string          ('courgettes', 'feta', 'huile d''olive', ...)
--   - note     : string | null   ('facultatif', 'pour les tartinettes')

alter table public.weekly_menus
  add column if not exists shopping_list_portions int,
  add column if not exists shopping_list_items jsonb;

comment on column public.weekly_menus.shopping_list_portions is
  'Nombre de personnes par défaut pour la liste de courses (extrait par Vision ou édité admin)';
comment on column public.weekly_menus.shopping_list_items is
  'Items structurés [{ category, label, quantity, unit, note }]';
