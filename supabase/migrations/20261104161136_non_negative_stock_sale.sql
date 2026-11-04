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
  v_shortage text;
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


  perform 1
  from public.inventory_items as ii
  where ii.id in (
    select ri.inventory_item_id
    from jsonb_array_elements(v_lines) as line
    cross join lateral private.recipe_for(
      (line ->> 'product_id')::uuid,
      nullif(line ->> 'variant_id', '')::uuid
    ) as ri
  )
  order by ii.id
  for update;

  select string_agg(
    format(
      '%s (hay %s, esta venta usa %s)',
      short.name,
      trim(trailing '.' from trim(to_char(short.stock, 'FM999999990.9999'))),
      trim(trailing '.' from trim(to_char(short.needed, 'FM999999990.9999')))
    ),
    '; ' order by short.name
  )
  into v_shortage
  from (
    select
      ii.name,
      ii.stock,
      round(sum(ri.quantity * (line ->> 'quantity')::numeric), 4) as needed
    from jsonb_array_elements(v_lines) as line
    cross join lateral private.recipe_for(
      (line ->> 'product_id')::uuid,
      nullif(line ->> 'variant_id', '')::uuid
    ) as ri
    join public.inventory_items as ii on ii.id = ri.inventory_item_id
    group by ii.id, ii.name, ii.stock
    having ii.stock < round(sum(ri.quantity * (line ->> 'quantity')::numeric), 4)
  ) as short;

  if v_shortage is not null then
    raise exception '%', 'No hay stock suficiente: ' || v_shortage;
  end if;

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
    select ri.inventory_item_id, round(sum(ri.quantity * lines.quantity), 4) as delta
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
        'level', case when updated.stock <= 0 then 'agotado' else 'bajo' end
      )
      order by updated.name
    )
    from updated
    where updated.stock <= updated.min_stock
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


