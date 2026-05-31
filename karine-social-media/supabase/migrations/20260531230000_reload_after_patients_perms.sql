-- Force reload du schema cache PostgREST pour les nouvelles tables
-- patient_requests et page_permissions (sinon les requêtes du middleware
-- échouent silencieusement avec PGRST204).
comment on table public.patient_requests is 'Demandes d''accès patient soumises par les utilisateurs';
comment on table public.page_permissions is 'Règles d''accès par chemin (CMS-style, configurable depuis /admin/permissions)';
