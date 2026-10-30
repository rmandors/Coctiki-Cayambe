-- Portería vende entrada y barra libre. El cajero no. El administrador vende todo.

alter table public.products
  add column door_only boolean not null default false;

update public.products
set door_only = true
where name in ('Entrada', 'Barra libre');

drop policy products_select on public.products;

create policy products_select on public.products
  for select to authenticated
  using (
    (select private.current_app_role()) = 'admin'::public.app_role
    or (
      (select private.current_app_role()) = 'portero'::public.app_role
      and door_only
    )
    or (
      (select private.current_app_role()) = 'cajero'::public.app_role
      and not door_only
    )
  );

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := 'cajero';
  v_meta_role text := new.raw_app_meta_data ->> 'role';
begin
  if v_meta_role in ('admin', 'cajero', 'portero') then
    v_role := v_meta_role::public.app_role;
  end if;

  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'usuario'), '@', 1)),
    coalesce(new.email, ''),
    v_role
  );
  return new;
end;
$$;

create or replace function private.enforce_sale_menu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := private.current_app_role();
  v_door boolean;
begin
  if new.product_id is null or v_role is null or v_role = 'admin'::public.app_role then
    return new;
  end if;

  select door_only into v_door
  from public.products
  where id = new.product_id;

  if v_role = 'portero'::public.app_role and v_door is distinct from true then
    raise exception 'Este producto no está en tu menú';
  end if;

  if v_role = 'cajero'::public.app_role and v_door is true then
    raise exception 'Este producto no está en tu menú';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_sale_menu() from public, anon, authenticated;

create trigger sale_items_menu
  before insert on public.sale_items
  for each row execute function private.enforce_sale_menu();
