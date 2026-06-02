-- ============================================================
-- Refonte du système d'autorisations : capabilities (actions/verbes)
-- au lieu de page_permissions (paths/roles).
--
-- Modèle : 2 états utilisateur seulement (Avec plan / Sans plan).
--  - "Avec plan" : patient actif, subscriber actif (trialing|active),
--    ou admin → toujours autorisé sur TOUTES les capacités.
--  - "Sans plan" : visiteur (connecté ou non) + patient/sub expiré
--    → autorisé uniquement sur les capabilities dont
--    allowed_without_plan = true.
--
-- Karine pilote depuis /admin/permissions une checkbox par capability.
-- ============================================================

create table if not exists public.capabilities (
  key                   text primary key,
  group_key             text not null,
  group_label           text not null,
  label                 text not null,
  description           text,
  allowed_without_plan  boolean not null default false,
  sort_order            int not null default 0,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles(id) on delete set null
);

create index if not exists capabilities_group_idx
  on public.capabilities (group_key, sort_order);

alter table public.capabilities enable row level security;

-- Lecture : publique (le middleware côté serveur lit pour TOUS les visiteurs)
drop policy if exists capabilities_read_public on public.capabilities;
create policy capabilities_read_public on public.capabilities
  for select using (true);

-- Écriture : admin seulement
drop policy if exists capabilities_admin_write on public.capabilities;
create policy capabilities_admin_write on public.capabilities
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Trigger updated_at
drop trigger if exists capabilities_set_updated_at on public.capabilities;
create trigger capabilities_set_updated_at
  before update on public.capabilities
  for each row execute function public.set_updated_at();

-- ---------- Seed des 12 capabilities validées ----------
-- ON CONFLICT DO NOTHING : Karine peut ajuster ses propres valeurs
-- depuis l'admin sans qu'un re-deploy ne les écrase.

insert into public.capabilities (key, group_key, group_label, label, description, allowed_without_plan, sort_order) values
  -- Recettes (groupe affiché : "Idées recettes")
  ('recipes.enter_section',         'recipes', 'Idées recettes', 'Naviguer dans la section',                 'Le visiteur peut entrer dans /recettes',                          true,  10),
  ('recipes.see_categories',        'recipes', 'Idées recettes', 'Voir les catégories',                       'Voir la liste des catégories (Entrées, Plats, Desserts...)',     true,  20),
  ('recipes.see_recipes_in_category','recipes','Idées recettes', 'Voir les recettes d''une catégorie',        'Parcourir les vignettes dans une catégorie',                     true,  30),
  ('recipes.open_recipe_detail',    'recipes', 'Idées recettes', 'Ouvrir une fiche recette en détail',        'Voir le contenu complet d''une fiche (ingrédients, étapes)',     false, 40),
  -- Menu de la semaine
  ('weekly_menu.enter_section',     'weekly_menu', 'Menu de la semaine', 'Naviguer dans la section',          'Le visiteur peut entrer dans /menus',                            true,  10),
  ('weekly_menu.see_current_cover', 'weekly_menu', 'Menu de la semaine', 'Voir le cover de la semaine en cours','Voir l''image / le titre du menu courant',                     true,  20),
  ('weekly_menu.navigate_weeks',    'weekly_menu', 'Menu de la semaine', 'Naviguer vers d''autres semaines',  'Paginer entre les menus passés/futurs',                          true,  30),
  ('weekly_menu.open_detail',       'weekly_menu', 'Menu de la semaine', 'Ouvrir le détail d''un menu',       'Voir le contenu détaillé (jours, recettes liées, courses)',      false, 40),
  -- Astuces
  ('tips.enter_section',            'tips', 'Astuces', 'Naviguer dans la section',                            'Le visiteur peut entrer dans /astuces',                          false, 10),
  -- Conseils
  ('advice.enter_section',          'advice', 'Conseils', 'Naviguer dans la section',                         'Le visiteur peut entrer dans /conseils',                         false, 10),
  -- Idées (bouton flottant ampoule)
  ('ideas.submit',                  'ideas', 'Idées (suggestions)', 'Soumettre une idée à Karine',            'Le visiteur peut soumettre une recette/astuce/question',         true,  10),
  -- Notifications
  ('notifications.access',          'notifications', 'Notifications', 'Voir et consulter ses notifications',  'Cloche dans le header + page /notifications',                    true,  10)
on conflict (key) do nothing;
