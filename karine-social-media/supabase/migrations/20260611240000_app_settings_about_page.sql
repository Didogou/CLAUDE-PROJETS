-- =============================================================
-- Contenu éditable de la page /a-propos (singleton app_settings).
--
-- Le texte est édité côté admin via /admin/parametres → composant
-- AboutPageEditor, et affiché côté utilisatrice sur /a-propos.
-- =============================================================

alter table public.app_settings
  add column if not exists about_page_content text;

comment on column public.app_settings.about_page_content is
  'Contenu Markdown léger affiché sur /a-propos. Édité par Karine.';
