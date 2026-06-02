-- Trigger handle_new_user étendu : copie aussi la photo de profil OAuth
-- (Google, Facebook) dans profiles.avatar_url au signup.
--
-- Clés OAuth possibles dans auth.users.raw_user_meta_data :
--   - 'avatar_url' (Google)
--   - 'picture' (Facebook + Google parfois)

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  resolved_role text;
  resolved_full_name text;
  resolved_avatar text;
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

  resolved_avatar := nullif(
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    ),
    ''
  );

  insert into public.profiles (id, email, role, full_name, avatar_url)
    values (new.id, new.email, resolved_role, resolved_full_name, resolved_avatar);
  return new;
end;
$$;

-- Backfill : pour les profils existants sans avatar_url, on lit la metadata OAuth
-- de auth.users et on copie. Idempotent.
update public.profiles p
set avatar_url = sub.resolved
from (
  select
    u.id,
    nullif(
      coalesce(
        u.raw_user_meta_data->>'avatar_url',
        u.raw_user_meta_data->>'picture'
      ),
      ''
    ) as resolved
  from auth.users u
) sub
where sub.id = p.id
  and p.avatar_url is null
  and sub.resolved is not null;
