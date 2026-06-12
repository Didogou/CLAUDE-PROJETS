-- =============================================================
-- Seed : catalogue de base des ustensiles de cuisine.
-- =============================================================
-- Liste curée des ustensiles courants (label capitalisé, slug en
-- minuscule sans accent = clé référencée par les fiches). Le catalogue
-- reste AUTO-ALIMENTÉ par l'extraction Vision ensuite ; ce seed donne
-- juste une base propre pour générer les images dès maintenant.
--
-- ON CONFLICT (slug) DO NOTHING : idempotent + ne touche pas aux
-- entrées déjà présentes (labels/images curés par Karine).

insert into public.utensils (slug, label) values
  ('couteau-de-chef',        'Couteau de chef'),
  ('couteau-d-office',       'Couteau d''office'),
  ('planche-a-decouper',     'Planche à découper'),
  ('saladier',               'Saladier'),
  ('cul-de-poule',           'Cul-de-poule'),
  ('bol',                    'Bol'),
  ('casserole',              'Casserole'),
  ('poele',                  'Poêle'),
  ('sauteuse',               'Sauteuse'),
  ('faitout',                'Faitout'),
  ('marmite',                'Marmite'),
  ('cocotte',                'Cocotte'),
  ('wok',                    'Wok'),
  ('four',                   'Four'),
  ('plaque-de-cuisson',      'Plaque de cuisson'),
  ('plat-a-four',            'Plat à four'),
  ('plat-a-gratin',          'Plat à gratin'),
  ('moule-a-gateau',         'Moule à gâteau'),
  ('moule-a-tarte',          'Moule à tarte'),
  ('ramequin',               'Ramequin'),
  ('fouet',                  'Fouet'),
  ('spatule',                'Spatule'),
  ('maryse',                 'Maryse'),
  ('cuillere-en-bois',       'Cuillère en bois'),
  ('louche',                 'Louche'),
  ('ecumoire',               'Écumoire'),
  ('passoire',               'Passoire'),
  ('chinois',                'Chinois'),
  ('rape',                   'Râpe'),
  ('econome',                'Économe'),
  ('presse-ail',             'Presse-ail'),
  ('presse-agrumes',         'Presse-agrumes'),
  ('mixeur-plongeant',       'Mixeur plongeant'),
  ('blender',                'Blender'),
  ('robot-culinaire',        'Robot culinaire'),
  ('batteur-electrique',     'Batteur électrique'),
  ('rouleau-a-patisserie',   'Rouleau à pâtisserie'),
  ('balance-de-cuisine',     'Balance de cuisine'),
  ('verre-doseur',           'Verre doseur'),
  ('mandoline',              'Mandoline'),
  ('ciseaux-de-cuisine',     'Ciseaux de cuisine'),
  ('ouvre-boite',            'Ouvre-boîte'),
  ('essoreuse-a-salade',     'Essoreuse à salade'),
  ('pinceau-de-cuisine',     'Pinceau de cuisine'),
  ('minuteur',               'Minuteur'),
  ('thermometre-de-cuisson', 'Thermomètre de cuisson')
on conflict (slug) do nothing;
