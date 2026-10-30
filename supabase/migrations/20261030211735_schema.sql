-- Coctiki: esquema, perfiles y RLS.
-- El rol vive en profiles, nunca en user_metadata (el usuario puede editarlo).

create extension if not exists pgcrypto;

create type public.app_role as enum ('cajero', 'admin');
create type public.payment_method as enum ('efectivo', 'transferencia', 'tarjeta');
create type public.sale_status as enum ('completada', 'anulada');
create type public.movement_reason as enum ('venta', 'anulacion', 'ajuste', 'compra');
create type public.inventory_unit as enum ('galon', 'litro', 'ml', 'kg', 'g', 'unidad');

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres, service_role, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.app_role not null default 'cajero',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint profiles_name_not_blank check (char_length(btrim(full_name)) > 0)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit public.inventory_unit not null,
  stock numeric(14, 4) not null default 0,
  min_stock numeric(14, 4) not null default 0,
  unit_cost numeric(14, 4) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint inventory_items_name_not_blank check (char_length(btrim(name)) > 0),
  constraint inventory_items_name_unique unique (name),
  constraint inventory_items_min_stock_nonnegative check (min_stock >= 0),
  constraint inventory_items_unit_cost_nonnegative check (unit_cost >= 0)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  price numeric(14, 2) not null,
  active boolean not null default true,
  requires_variant boolean not null default false,
  created_at timestamptz not null default now(),
  constraint products_name_not_blank check (char_length(btrim(name)) > 0),
  constraint products_category_not_blank check (char_length(btrim(category)) > 0),
  constraint products_price_nonnegative check (price >= 0)
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  price numeric(14, 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint product_variants_name_not_blank check (char_length(btrim(name)) > 0),
  constraint product_variants_price_nonnegative check (price is null or price >= 0),
  constraint product_variants_unique unique (product_id, name)
);

create table public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  quantity numeric(14, 4) not null,
  constraint recipe_items_quantity_positive check (quantity > 0),
  constraint recipe_items_scope_item unique nulls not distinct (product_id, variant_id, inventory_item_id)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number integer generated always as identity,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  payment_method public.payment_method not null,
  subtotal numeric(14, 2) not null,
  discount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null,
  status public.sale_status not null default 'completada',
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  constraint sales_user_id_fkey foreign key (user_id) references public.profiles (id),
  constraint sales_voided_by_fkey foreign key (voided_by) references public.profiles (id),
  constraint sales_subtotal_nonnegative check (subtotal >= 0),
  constraint sales_discount_nonnegative check (discount >= 0),
  constraint sales_total_nonnegative check (total >= 0),
  constraint sales_discount_lte_subtotal check (discount <= subtotal),
  constraint sales_total_matches check (total = subtotal - discount),
  constraint sales_void_reason_length check (void_reason is null or char_length(void_reason) <= 300)
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  product_name text not null,
  variant_name text,
  quantity numeric(14, 3) not null,
  unit_price numeric(14, 2) not null,
  unit_cost numeric(14, 4) not null,
  constraint sale_items_quantity_positive check (quantity > 0),
  constraint sale_items_unit_price_nonnegative check (unit_price >= 0),
  constraint sale_items_unit_cost_nonnegative check (unit_cost >= 0)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id),
  sale_id uuid references public.sales (id) on delete set null,
  change numeric(14, 4) not null,
  reason public.movement_reason not null,
  user_id uuid references public.profiles (id),
  note text,
  created_at timestamptz not null default now(),
  constraint inventory_movements_note_length check (note is null or char_length(note) <= 300)
);

create index sales_created_at_idx on public.sales (created_at desc);
create index sales_user_created_at_idx on public.sales (user_id, created_at desc);
create index sale_items_sale_id_idx on public.sale_items (sale_id);
create index recipe_items_product_idx on public.recipe_items (product_id);
create index inventory_movements_item_idx on public.inventory_movements (inventory_item_id, created_at desc);

create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = (select auth.uid())
    and p.active = true
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.current_app_role() = 'admin'::public.app_role
$$;

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
  if v_meta_role in ('admin', 'cajero') then
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.protect_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger profiles_protect
  before update on public.profiles
  for each row execute function private.protect_profile();

create or replace function private.recipe_variant_matches_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.variant_id is not null and not exists (
    select 1
    from public.product_variants as v
    where v.id = new.variant_id
      and v.product_id = new.product_id
  ) then
    raise exception 'El sabor no pertenece al producto';
  end if;
  return new;
end;
$$;

create trigger recipe_items_variant_check
  before insert or update on public.recipe_items
  for each row execute function private.recipe_variant_matches_product();

alter table public.profiles enable row level security;
alter table public.inventory_items enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.recipe_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.inventory_movements enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.current_app_role()) = 'admin'::public.app_role
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role)
  with check ((select private.current_app_role()) = 'admin'::public.app_role);

create policy products_select on public.products
  for select to authenticated
  using ((select private.current_app_role()) is not null);

create policy products_insert on public.products
  for insert to authenticated
  with check ((select private.current_app_role()) = 'admin'::public.app_role);

create policy products_update on public.products
  for update to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role)
  with check ((select private.current_app_role()) = 'admin'::public.app_role);

create policy products_delete on public.products
  for delete to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role);

create policy variants_select on public.product_variants
  for select to authenticated
  using ((select private.current_app_role()) is not null);

create policy variants_insert on public.product_variants
  for insert to authenticated
  with check ((select private.current_app_role()) = 'admin'::public.app_role);

create policy variants_update on public.product_variants
  for update to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role)
  with check ((select private.current_app_role()) = 'admin'::public.app_role);

create policy variants_delete on public.product_variants
  for delete to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role);

create policy recipes_select on public.recipe_items
  for select to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role);

create policy recipes_insert on public.recipe_items
  for insert to authenticated
  with check ((select private.current_app_role()) = 'admin'::public.app_role);

create policy recipes_update on public.recipe_items
  for update to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role)
  with check ((select private.current_app_role()) = 'admin'::public.app_role);

create policy recipes_delete on public.recipe_items
  for delete to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role);

create policy inventory_select on public.inventory_items
  for select to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role);

create policy inventory_insert on public.inventory_items
  for insert to authenticated
  with check ((select private.current_app_role()) = 'admin'::public.app_role);

create policy inventory_update on public.inventory_items
  for update to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role)
  with check ((select private.current_app_role()) = 'admin'::public.app_role);

create policy inventory_delete on public.inventory_items
  for delete to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role);

create policy sales_select on public.sales
  for select to authenticated
  using (
    (select private.current_app_role()) is not null
    and (
      user_id = (select auth.uid())
      or (select private.current_app_role()) = 'admin'::public.app_role
    )
  );

create policy sale_items_select on public.sale_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.sales as s
      where s.id = sale_id
        and (select private.current_app_role()) is not null
        and (
          s.user_id = (select auth.uid())
          or (select private.current_app_role()) = 'admin'::public.app_role
        )
    )
  );

create policy movements_select on public.inventory_movements
  for select to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role);

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.product_variants to authenticated;
grant select, insert, update, delete on public.recipe_items to authenticated;
grant select, insert, update, delete on public.inventory_items to authenticated;
grant select on public.sales to authenticated;
grant select on public.sale_items to authenticated;
grant select on public.inventory_movements to authenticated;

revoke all on function private.current_app_role() from public, anon;
grant execute on function private.current_app_role() to authenticated;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.protect_profile() from public, anon, authenticated;
revoke all on function private.recipe_variant_matches_product() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
    grant execute on function private.handle_new_user() to supabase_auth_admin;
  end if;
end $$;
