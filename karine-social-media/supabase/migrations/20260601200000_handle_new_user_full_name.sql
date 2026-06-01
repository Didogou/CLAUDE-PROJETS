-- Le trigger handle_new_user() ne copiait pas le full_name passé en
-- metadata (auth.users.raw_user_meta_data). Résultat : tous les profils
-- créés depuis SignupForm ou via OAuth Google/Facebook étaient « (nom non
-- renseigné) » côté admin.
--
-- On reprend la même logique role/admin_whitelist et on ajoute la lecture
-- de raw_user_meta_data avec 2 clés possibles :
--   - full_name : ce qu'on envoie depuis SignupForm
--   - name     : ce que Google / Facebook OAuth fournit par défaut
-- Les 2 sont essayées en cascade, nullif('') pour éviter les noms vides.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  resolved_role text;
  resolved_full_name text;
begin
  if new.email is not null and exists (
    select 1 from public.admin_emails where lower(email) = lower(new.email)
  ) then
    resolved_role := 'admin';
  else
    resolved_role := 'visitor';
  end if;

  resolved_full_name := nullif(
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    ),
    ''
  );

  insert into public.profiles (id, email, role, full_name)
    values (new.id, new.email, resolved_role, resolved_full_name);
  return new;
end;
$$;

-- Backfill : pour les profils existants sans full_name, on relit la metadata
-- de auth.users et on copie. Idempotent.
update public.profiles p
set full_name = sub.resolved
from (
  select
    u.id,
    nullif(
      coalesce(
        u.raw_user_meta_data->>'full_name',
        u.raw_user_meta_data->>'name'
      ),
      ''
    ) as resolved
  from auth.users u
) sub
where sub.id = p.id
  and p.full_name is null
  and sub.resolved is not null;
