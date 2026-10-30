-- Catálogo real y precio de jarras por cantidad.
-- 1 jarra $8, 2 jarras $15, 3 jarras $20. De 4 en adelante se arma con esos paquetes:
-- 4 = 3+1 ($28), 5 = 3+2 ($35), 6 = 3+3 ($40).

create table public.product_price_tiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  quantity integer not null,
  total_price numeric(14, 2) not null,
  constraint product_price_tiers_quantity_positive check (quantity > 1),
  constraint product_price_tiers_price_nonnegative check (total_price >= 0),
  constraint product_price_tiers_unique unique (product_id, quantity)
);

alter table public.product_price_tiers enable row level security;

create policy price_tiers_select on public.product_price_tiers
  for select to authenticated
  using ((select private.current_app_role()) is not null);

create policy price_tiers_insert on public.product_price_tiers
  for insert to authenticated
  with check ((select private.current_app_role()) = 'admin'::public.app_role);

create policy price_tiers_update on public.product_price_tiers
  for update to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role)
  with check ((select private.current_app_role()) = 'admin'::public.app_role);

create policy price_tiers_delete on public.product_price_tiers
  for delete to authenticated
  using ((select private.current_app_role()) = 'admin'::public.app_role);

grant select, insert, update, delete on public.product_price_tiers to authenticated;

alter table public.sale_items
  add column line_total numeric(14, 2);

update public.sale_items
set line_total = round(quantity * unit_price, 2)
where line_total is null;

alter table public.sale_items
  alter column line_total set not null;

alter table public.sale_items
  add constraint sale_items_line_total_nonnegative check (line_total >= 0);

create or replace function private.bundle_total(
  p_product_id uuid,
  p_quantity integer,
  p_base numeric
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_packs integer[] := array[1];
  v_costs integer[] := array[round(p_base * 100)::integer];
  v_dp integer[];
  v_q integer;
  v_i integer;
  v_size integer;
  v_cost integer;
  v_next integer;
  v_best integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    return 0;
  end if;

  for v_size, v_cost in
    select t.quantity, round(t.total_price * 100)::integer
    from public.product_price_tiers as t
    where t.product_id = p_product_id
      and t.quantity > 0
  loop
    if v_size = 1 then
      v_costs[1] := v_cost;
    else
      v_packs := v_packs || v_size;
      v_costs := v_costs || v_cost;
    end if;
  end loop;

  v_dp := array_fill(-1, array[p_quantity + 1]);
  v_dp[1] := 0;

  for v_q in 1..p_quantity loop
    v_best := null;
    for v_i in 1..coalesce(array_length(v_packs, 1), 0) loop
      v_size := v_packs[v_i];
      v_cost := v_costs[v_i];
      if v_size <= v_q and v_dp[(v_q - v_size) + 1] >= 0 then
        v_next := v_dp[(v_q - v_size) + 1] + v_cost;
        if v_best is null or v_next < v_best then
          v_best := v_next;
        end if;
      end if;
    end loop;
    if v_best is null then
      v_dp[v_q + 1] := -1;
    else
      v_dp[v_q + 1] := v_best;
    end if;
  end loop;

  if v_dp[p_quantity + 1] < 0 then
    return round(p_base * p_quantity, 2);
  end if;
  return round(v_dp[p_quantity + 1] / 100.0, 2);
end;
$$;

revoke all on function private.bundle_total(uuid, integer, numeric) from public, anon, authenticated;


create or replace function private.create_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_discount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_product public.products;
  v_variant public.product_variants;
  v_product_id uuid;
  v_variant_id uuid;
  v_qty numeric;
  v_price numeric;
  v_cost numeric;
  v_variant_name text;
  v_lines jsonb := '[]'::jsonb;
  v_subtotal numeric(14, 2) := 0;
  v_discount numeric(14, 2);
  v_total numeric(14, 2);
  v_sale_id uuid;
  v_sale_number integer;
  v_created_at timestamptz;
  v_warnings jsonb := '[]'::jsonb;
  v_group record;
  v_state jsonb := '{}'::jsonb;
  v_bundle numeric(14, 2);
  v_units integer;
  v_cents integer;
  v_base_cents integer;
  v_extra integer;
  v_line_cents integer;
  v_piece integer;
  v_index integer;
  v_priced jsonb;
  v_key text;
begin
  if v_uid is null or not exists (
    select 1 from public.profiles where id = v_uid and active = true
  ) then
    raise exception 'No autenticado';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;

  if jsonb_array_length(p_items) > 100 then
    raise exception 'La venta tiene demasiados productos';
  end if;

  if p_discount is null or p_discount < 0 then
    raise exception 'Descuento inválido';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if v_item ->> 'product_id' is null or v_item ->> 'quantity' is null then
      raise exception 'Cada producto necesita identificador y cantidad';
    end if;

    begin
      v_product_id := (v_item ->> 'product_id')::uuid;
      v_variant_id := nullif(v_item ->> 'variant_id', '')::uuid;
      v_qty := round((v_item ->> 'quantity')::numeric, 3);
    exception
      when invalid_text_representation then
        raise exception 'Producto o cantidad inválidos';
    end;

    if v_qty is null or v_qty <= 0 or v_qty > 999 then
      raise exception 'Cantidad inválida';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id and active = true;

    if not found then
      raise exception 'Hay un producto que ya no está disponible';
    end if;

    v_variant_name := null;

    if v_product.requires_variant then
      if v_variant_id is null then
        raise exception 'Elige el sabor de %', v_product.name;
      end if;

      select * into v_variant
      from public.product_variants
      where id = v_variant_id and product_id = v_product.id and active = true;

      if not found then
        raise exception 'Ese sabor de % no está disponible', v_product.name;
      end if;

      v_variant_name := v_variant.name;
      v_price := round(coalesce(v_variant.price, v_product.price), 2);
    else
      if v_variant_id is not null then
        raise exception '% no usa sabores', v_product.name;
      end if;
      v_price := round(v_product.price, 2);
    end if;

    select coalesce(sum(ri.quantity * ii.unit_cost), 0)
    into v_cost
    from private.recipe_for(v_product.id, v_variant_id) as ri
    join public.inventory_items as ii on ii.id = ri.inventory_item_id;

    v_subtotal := v_subtotal + round(v_price * v_qty, 2);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'variant_id', v_variant_id,
      'product_name', v_product.name,
      'variant_name', v_variant_name,
      'quantity', v_qty,
      'unit_price', v_price,
      'unit_cost', round(v_cost, 4)
    ));
  end loop;

  v_subtotal := 0;
  v_state := '{}'::jsonb;

  for v_group in
    select
      (line ->> 'product_id')::uuid as product_id,
      sum((line ->> 'quantity')::numeric) as quantity,
      bool_and((line ->> 'quantity')::numeric = trunc((line ->> 'quantity')::numeric)) as is_whole
    from jsonb_array_elements(v_lines) as line
    group by 1
  loop
    select p.price into v_price
    from public.products as p
    where p.id = v_group.product_id;

    if v_group.is_whole and exists (
      select 1 from public.product_price_tiers as t where t.product_id = v_group.product_id
    ) then
      v_bundle := private.bundle_total(v_group.product_id, v_group.quantity::integer, v_price);
      v_units := v_group.quantity::integer;
      v_cents := round(v_bundle * 100)::integer;
      v_base_cents := v_cents / v_units;
      v_extra := v_cents - (v_base_cents * v_units);
      v_state := v_state || jsonb_build_object(
        v_group.product_id::text,
        jsonb_build_object('bundle', true, 'base_cents', v_base_cents, 'extra', v_extra)
      );
    else
      select coalesce(sum(round((line ->> 'unit_price')::numeric * (line ->> 'quantity')::numeric, 2)), 0)
      into v_bundle
      from jsonb_array_elements(v_lines) as line
      where (line ->> 'product_id')::uuid = v_group.product_id;
    end if;

    v_subtotal := v_subtotal + v_bundle;
  end loop;

  v_priced := '[]'::jsonb;
  for v_item in select value from jsonb_array_elements(v_lines)
  loop
    v_key := v_item ->> 'product_id';
    v_qty := (v_item ->> 'quantity')::numeric;
    if coalesce((v_state -> v_key ->> 'bundle')::boolean, false) then
      v_base_cents := (v_state -> v_key ->> 'base_cents')::integer;
      v_extra := (v_state -> v_key ->> 'extra')::integer;
      v_line_cents := 0;
      v_index := 1;
      while v_index <= v_qty loop
        v_piece := v_base_cents + case when v_extra > 0 then 1 else 0 end;
        if v_extra > 0 then
          v_extra := v_extra - 1;
        end if;
        v_line_cents := v_line_cents + v_piece;
        v_index := v_index + 1;
      end loop;
      v_state := jsonb_set(v_state, array[v_key, 'extra'], to_jsonb(v_extra));
      v_item := v_item || jsonb_build_object(
        'unit_price', round(v_line_cents / 100.0 / v_qty, 2),
        'line_total', round(v_line_cents / 100.0, 2)
      );
    else
      v_item := v_item || jsonb_build_object(
        'line_total', round((v_item ->> 'unit_price')::numeric * v_qty, 2)
      );
    end if;
    v_priced := v_priced || jsonb_build_array(v_item);
  end loop;
  v_lines := v_priced;

  v_discount := round(p_discount, 2);
  if v_discount > v_subtotal then
    raise exception 'El descuento no puede superar el subtotal';
  end if;
  v_total := v_subtotal - v_discount;

  insert into public.sales (user_id, payment_method, subtotal, discount, total)
  values (v_uid, p_payment_method, v_subtotal, v_discount, v_total)
  returning id, sale_number, created_at into v_sale_id, v_sale_number, v_created_at;

  insert into public.sale_items (
    sale_id, product_id, variant_id, product_name, variant_name, quantity, unit_price, unit_cost, line_total
  )
  select
    v_sale_id,
    (line ->> 'product_id')::uuid,
    nullif(line ->> 'variant_id', '')::uuid,
    line ->> 'product_name',
    line ->> 'variant_name',
    (line ->> 'quantity')::numeric,
    (line ->> 'unit_price')::numeric,
    (line ->> 'unit_cost')::numeric,
    (line ->> 'line_total')::numeric
  from jsonb_array_elements(v_lines) as line;

  with lines as (
    select
      (line ->> 'product_id')::uuid as product_id,
      nullif(line ->> 'variant_id', '')::uuid as variant_id,
      (line ->> 'quantity')::numeric as quantity
    from jsonb_array_elements(v_lines) as line
  ),
  deltas as (
    select ri.inventory_item_id, sum(ri.quantity * lines.quantity) as delta
    from lines
    cross join lateral private.recipe_for(lines.product_id, lines.variant_id) as ri
    group by ri.inventory_item_id
  ),
  locked as (
    select ii.id
    from public.inventory_items as ii
    join deltas as d on d.inventory_item_id = ii.id
    order by ii.id
    for update of ii
  ),
  updated as (
    update public.inventory_items as ii
    set stock = ii.stock - d.delta
    from deltas as d
    where ii.id = d.inventory_item_id
      and ii.id in (select locked.id from locked)
    returning ii.id, ii.name, ii.unit, ii.stock, ii.min_stock, d.delta
  ),
  moved as (
    insert into public.inventory_movements (inventory_item_id, sale_id, change, reason, user_id)
    select updated.id, v_sale_id, -updated.delta, 'venta', v_uid
    from updated
    where updated.delta <> 0
    returning 1
  )
  select coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'item_id', updated.id,
        'item_name', updated.name,
        'unit', updated.unit,
        'stock', updated.stock,
        'min_stock', updated.min_stock,
        'level', case when updated.stock < 0 then 'negativo' else 'bajo' end
      )
      order by updated.name
    )
    from updated
    where updated.stock < 0 or updated.stock <= updated.min_stock
  ), '[]'::jsonb)
  into v_warnings
  from (select count(*) from moved) as executed;

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'created_at', v_created_at,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'total', v_total,
    'payment_method', p_payment_method,
    'warnings', coalesce(v_warnings, '[]'::jsonb)
  );
end;
$$;

create or replace function private.get_kpis(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_count bigint;
  v_revenue numeric;
  v_discounts numeric;
  v_cost numeric;
  v_by_day jsonb;
  v_by_payment jsonb;
  v_top jsonb;
begin
  if (select private.current_app_role()) is distinct from 'admin'::public.app_role then
    raise exception 'Solo un administrador puede ver los indicadores';
  end if;

  if p_from is null or p_to is null then
    raise exception 'Indica el rango de fechas';
  end if;

  if p_to < p_from then
    raise exception 'La fecha final es anterior a la inicial';
  end if;

  if p_to - p_from > 366 then
    raise exception 'El rango máximo es de un año';
  end if;

  v_start := (p_from::timestamp) at time zone 'America/Guayaquil';
  v_end := ((p_to + 1)::timestamp) at time zone 'America/Guayaquil';

  select
    count(*),
    coalesce(sum(total), 0),
    coalesce(sum(discount), 0)
  into v_count, v_revenue, v_discounts
  from public.sales
  where status = 'completada'
    and created_at >= v_start
    and created_at < v_end;

  select coalesce(sum(si.quantity * si.unit_cost), 0)
  into v_cost
  from public.sale_items as si
  join public.sales as s on s.id = si.sale_id
  where s.status = 'completada'
    and s.created_at >= v_start
    and s.created_at < v_end;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day', to_char(d.day, 'YYYY-MM-DD'),
      'revenue', round(d.revenue, 2),
      'cost', round(d.cost, 2),
      'sales_count', d.sales_count
    )
    order by d.day
  ), '[]'::jsonb)
  into v_by_day
  from (
    select
      gs::date as day,
      coalesce(sum(s.total), 0) as revenue,
      coalesce(sum(ic.cost), 0) as cost,
      count(s.id) as sales_count
    from generate_series(p_from, p_to, interval '1 day') as gs
    left join public.sales as s
      on s.status = 'completada'
      and (s.created_at at time zone 'America/Guayaquil')::date = gs::date
    left join lateral (
      select coalesce(sum(si.quantity * si.unit_cost), 0) as cost
      from public.sale_items as si
      where si.sale_id = s.id
    ) as ic on true
    group by gs::date
  ) as d;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'method', p.payment_method,
      'revenue', round(p.revenue, 2),
      'sales_count', p.sales_count
    )
  ), '[]'::jsonb)
  into v_by_payment
  from (
    select payment_method, sum(total) as revenue, count(*) as sales_count
    from public.sales
    where status = 'completada'
      and created_at >= v_start
      and created_at < v_end
    group by payment_method
  ) as p;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', t.product_name,
      'variant', t.variant_name,
      'quantity', t.quantity,
      'revenue', round(t.revenue, 2),
      'cost', round(t.cost, 2)
    )
    order by t.revenue desc
  ), '[]'::jsonb)
  into v_top
  from (
    select
      si.product_name,
      si.variant_name,
      sum(si.quantity) as quantity,
      sum(
        si.line_total * case
          when s.subtotal = 0 then 0
          else s.total / s.subtotal
        end
      ) as revenue,
      sum(si.quantity * si.unit_cost) as cost
    from public.sale_items as si
    join public.sales as s on s.id = si.sale_id
    where s.status = 'completada'
      and s.created_at >= v_start
      and s.created_at < v_end
    group by si.product_name, si.variant_name
    order by revenue desc
    limit 8
  ) as t;

  return jsonb_build_object(
    'sales_count', v_count,
    'revenue', round(v_revenue, 2),
    'discounts', round(v_discounts, 2),
    'cost', round(v_cost, 2),
    'profit', round(v_revenue - v_cost, 2),
    'margin_pct', case
      when v_revenue = 0 then 0
      else round((v_revenue - v_cost) / v_revenue * 100, 1)
    end,
    'avg_ticket', case
      when v_count = 0 then 0
      else round(v_revenue / v_count, 2)
    end,
    'by_day', v_by_day,
    'by_payment', v_by_payment,
    'top_products', v_top
  );
end;
$$;

-- Quita el menú de ejemplo y carga el catálogo del local.
delete from public.products
where id in (
  'b1111111-1111-4111-8111-111111111101',
  'b1111111-1111-4111-8111-111111111102',
  'b1111111-1111-4111-8111-111111111103'
);

delete from public.inventory_items
where id in (
  'a1111111-1111-4111-8111-111111111101',
  'a1111111-1111-4111-8111-111111111102',
  'a1111111-1111-4111-8111-111111111103',
  'a1111111-1111-4111-8111-111111111104',
  'a1111111-1111-4111-8111-111111111105',
  'a1111111-1111-4111-8111-111111111106'
)
and not exists (
  select 1
  from public.inventory_movements as m
  where m.inventory_item_id = inventory_items.id
);

insert into public.inventory_items (id, name, unit, stock, min_stock, unit_cost)
values
  ('a2222222-2222-4222-8222-222222222201', 'Preparado de jarras', 'galon', 0, 1, 0),
  ('a2222222-2222-4222-8222-222222222202', 'Botella Coctiki', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222203', 'Botella Antioqueño', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222204', 'Botella Corona', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222205', 'Botella Club', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222206', 'Botella Heineken', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222207', 'Botella Pilsener', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222208', 'Botella Agua', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222209', 'Lata Corona', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222210', 'Lata Club', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222211', 'Lata Heineken', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222212', 'Lata Pilsener', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222213', 'Cigarrillo', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222214', 'Chupete', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222215', 'Entrada', 'unidad', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222216', 'Barra libre', 'unidad', 0, 0, 0)
on conflict (id) do nothing;

insert into public.products (id, name, category, price, requires_variant)
values
  ('b2222222-2222-4222-8222-222222222201', 'Jarra', 'Jarras', 8, true),
  ('b2222222-2222-4222-8222-222222222202', 'Botella Coctiki', 'Coctiki', 8, false),
  ('b2222222-2222-4222-8222-222222222203', 'Antioqueño', 'Botellas', 28, false),
  ('b2222222-2222-4222-8222-222222222204', 'Corona', 'Botellas', 3.50, false),
  ('b2222222-2222-4222-8222-222222222205', 'Club', 'Botellas', 3, false),
  ('b2222222-2222-4222-8222-222222222206', 'Heineken', 'Botellas', 3, false),
  ('b2222222-2222-4222-8222-222222222207', 'Pilsener', 'Botellas', 2.50, false),
  ('b2222222-2222-4222-8222-222222222208', 'Agua', 'Botellas', 1, false),
  ('b2222222-2222-4222-8222-222222222209', 'Corona', 'Latas', 3.50, false),
  ('b2222222-2222-4222-8222-222222222210', 'Club', 'Latas', 3, false),
  ('b2222222-2222-4222-8222-222222222211', 'Heineken', 'Latas', 3, false),
  ('b2222222-2222-4222-8222-222222222212', 'Pilsener', 'Latas', 2.50, false),
  ('b2222222-2222-4222-8222-222222222213', 'Cigarrillo', 'Otros', 0.50, false),
  ('b2222222-2222-4222-8222-222222222214', 'Chupete', 'Otros', 0.50, false),
  ('b2222222-2222-4222-8222-222222222215', 'Entrada', 'Otros', 4, false),
  ('b2222222-2222-4222-8222-222222222216', 'Barra libre', 'Otros', 10, false)
on conflict (id) do nothing;

insert into public.product_variants (id, product_id, name)
values
  ('c2222222-2222-4222-8222-222222222201', 'b2222222-2222-4222-8222-222222222201', 'Mango sal'),
  ('c2222222-2222-4222-8222-222222222202', 'b2222222-2222-4222-8222-222222222201', 'Maracuya sal'),
  ('c2222222-2222-4222-8222-222222222203', 'b2222222-2222-4222-8222-222222222201', 'Tamarindo sal'),
  ('c2222222-2222-4222-8222-222222222204', 'b2222222-2222-4222-8222-222222222201', 'Naranjilla sal'),
  ('c2222222-2222-4222-8222-222222222205', 'b2222222-2222-4222-8222-222222222201', 'Jagger'),
  ('c2222222-2222-4222-8222-222222222206', 'b2222222-2222-4222-8222-222222222201', 'Mora azul'),
  ('c2222222-2222-4222-8222-222222222207', 'b2222222-2222-4222-8222-222222222201', 'Fresa'),
  ('c2222222-2222-4222-8222-222222222208', 'b2222222-2222-4222-8222-222222222201', '7 sabores'),
  ('c2222222-2222-4222-8222-222222222209', 'b2222222-2222-4222-8222-222222222201', 'Coco'),
  ('c2222222-2222-4222-8222-222222222210', 'b2222222-2222-4222-8222-222222222201', 'Durazno'),
  ('c2222222-2222-4222-8222-222222222211', 'b2222222-2222-4222-8222-222222222201', 'Manzana'),
  ('c2222222-2222-4222-8222-222222222212', 'b2222222-2222-4222-8222-222222222201', 'Piña coco'),
  ('c2222222-2222-4222-8222-222222222213', 'b2222222-2222-4222-8222-222222222201', 'Curazao'),
  ('c2222222-2222-4222-8222-222222222214', 'b2222222-2222-4222-8222-222222222201', 'Algodón de azúcar'),
  ('c2222222-2222-4222-8222-222222222215', 'b2222222-2222-4222-8222-222222222201', 'Maracuya'),
  ('c2222222-2222-4222-8222-222222222216', 'b2222222-2222-4222-8222-222222222201', 'Maracuya frutos rojos')
on conflict (id) do nothing;

insert into public.product_price_tiers (id, product_id, quantity, total_price)
values
  ('e2222222-2222-4222-8222-222222222202', 'b2222222-2222-4222-8222-222222222201', 2, 15),
  ('e2222222-2222-4222-8222-222222222203', 'b2222222-2222-4222-8222-222222222201', 3, 20)
on conflict (id) do nothing;

insert into public.recipe_items (id, product_id, variant_id, inventory_item_id, quantity)
values
  ('d2222222-2222-4222-8222-222222222201', 'b2222222-2222-4222-8222-222222222201', null, 'a2222222-2222-4222-8222-222222222201', 0.1667),
  ('d2222222-2222-4222-8222-222222222202', 'b2222222-2222-4222-8222-222222222202', null, 'a2222222-2222-4222-8222-222222222202', 1),
  ('d2222222-2222-4222-8222-222222222203', 'b2222222-2222-4222-8222-222222222203', null, 'a2222222-2222-4222-8222-222222222203', 1),
  ('d2222222-2222-4222-8222-222222222204', 'b2222222-2222-4222-8222-222222222204', null, 'a2222222-2222-4222-8222-222222222204', 1),
  ('d2222222-2222-4222-8222-222222222205', 'b2222222-2222-4222-8222-222222222205', null, 'a2222222-2222-4222-8222-222222222205', 1),
  ('d2222222-2222-4222-8222-222222222206', 'b2222222-2222-4222-8222-222222222206', null, 'a2222222-2222-4222-8222-222222222206', 1),
  ('d2222222-2222-4222-8222-222222222207', 'b2222222-2222-4222-8222-222222222207', null, 'a2222222-2222-4222-8222-222222222207', 1),
  ('d2222222-2222-4222-8222-222222222208', 'b2222222-2222-4222-8222-222222222208', null, 'a2222222-2222-4222-8222-222222222208', 1),
  ('d2222222-2222-4222-8222-222222222209', 'b2222222-2222-4222-8222-222222222209', null, 'a2222222-2222-4222-8222-222222222209', 1),
  ('d2222222-2222-4222-8222-222222222210', 'b2222222-2222-4222-8222-222222222210', null, 'a2222222-2222-4222-8222-222222222210', 1),
  ('d2222222-2222-4222-8222-222222222211', 'b2222222-2222-4222-8222-222222222211', null, 'a2222222-2222-4222-8222-222222222211', 1),
  ('d2222222-2222-4222-8222-222222222212', 'b2222222-2222-4222-8222-222222222212', null, 'a2222222-2222-4222-8222-222222222212', 1),
  ('d2222222-2222-4222-8222-222222222213', 'b2222222-2222-4222-8222-222222222213', null, 'a2222222-2222-4222-8222-222222222213', 1),
  ('d2222222-2222-4222-8222-222222222214', 'b2222222-2222-4222-8222-222222222214', null, 'a2222222-2222-4222-8222-222222222214', 1),
  ('d2222222-2222-4222-8222-222222222215', 'b2222222-2222-4222-8222-222222222215', null, 'a2222222-2222-4222-8222-222222222215', 1),
  ('d2222222-2222-4222-8222-222222222216', 'b2222222-2222-4222-8222-222222222216', null, 'a2222222-2222-4222-8222-222222222216', 1)
on conflict (id) do nothing;
