-- La cuenta raymond-admin@coctiki.com no se puede renombrar, cambiar de rol,
-- desactivar, banear ni eliminar, ni siquiera por otro administrador.

create or replace function private.protect_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(old.email) = 'raymond-admin@coctiki.com' then
    if new.role is distinct from old.role
      or new.active is distinct from old.active
      or new.full_name is distinct from old.full_name
      or new.id is distinct from old.id
    then
      raise exception 'Esta cuenta no se puede modificar';
    end if;
  end if;

  if (select auth.uid()) is not null and new.id = (select auth.uid()) then
    if new.role is distinct from old.role then
      raise exception 'No puedes cambiar tu propio rol';
    end if;
    if old.active = true and new.active = false then
      raise exception 'No puedes desactivar tu propia cuenta';
    end if;
  end if;

  new.email := old.email;
  return new;
end;
$$;

create or replace function private.protect_owner_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(old.email, '')) is distinct from 'raymond-admin@coctiki.com' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Esta cuenta no se puede eliminar';
  end if;

  if new.email is distinct from old.email
    or new.banned_until is distinct from old.banned_until
    or (new.raw_app_meta_data ->> 'role') is distinct from (old.raw_app_meta_data ->> 'role')
  then
    raise exception 'Esta cuenta no se puede modificar';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_owner_auth_user on auth.users;

create trigger protect_owner_auth_user
  before update or delete on auth.users
  for each row execute function private.protect_owner_auth_user();

revoke all on function private.protect_owner_auth_user() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
    grant execute on function private.protect_owner_auth_user() to supabase_auth_admin;
  end if;
end $$;
