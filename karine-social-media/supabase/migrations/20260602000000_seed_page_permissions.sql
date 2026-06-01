-- ============================================================
-- Seed des permissions par défaut pour les pages restreintes.
-- Le proxy (src/lib/supabase/middleware.ts) cherche la règle la plus
-- spécifique pour le path courant via expandPath, qui remonte par
-- ancêtres. Donc une règle sur /recettes couvre aussi /recettes/[slug]
-- et /recettes/desserts, /recettes/plats, etc.
--
-- ON CONFLICT DO NOTHING pour ne pas écraser une config faite depuis
-- /admin/permissions par Karine. La migration est idempotente.
-- ============================================================

insert into public.page_permissions (path, allowed_roles, description) values
  ('/recettes',    array['patient','subscriber','admin']::text[], 'Toutes les recettes (catégories + fiche détail)'),
  ('/menus',       array['patient','subscriber','admin']::text[], 'Menus de la semaine + détails'),
  ('/astuces',     array['patient','subscriber','admin']::text[], 'Astuces diététiques'),
  ('/conseils',    array['patient','subscriber','admin']::text[], 'Conseils santé')
on conflict (path) do nothing;
