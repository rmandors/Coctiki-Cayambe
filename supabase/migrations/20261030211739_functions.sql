-- Operaciones transaccionales. La lógica vive en private (security definer)
-- y public solo expone un envoltorio security invoker para PostgREST.

create or replace function private.recipe_for(p_product_id uuid, p_variant_id uuid)
returns setof public.recipe_items
language sql
stable
security definer
set search_path = ''
as $$
  select ri.*
  from public.recipe_items as ri
  where ri.product_id = p_product_id
    and (
      (
        p_variant_id is not null
        and exists (
          select 1
          from public.recipe_items as specific
          where specific.product_id = p_product_id
            and specific.variant_id = p_variant_id
        )
        and ri.variant_id = p_variant_id
      )
      or (
        (
          p_variant_id is null
          or not exists (
            select 1
            from public.recipe_items as specific
            where specific.product_id = p_product_id
              and specific.variant_id = p_variant_id
          )
        )
        and ri.variant_id is null
      )
    );
$$;

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

  v_discount := round(p_discount, 2);
  if v_discount > v_subtotal then
    raise exception 'El descuento no puede superar el subtotal';
  end if;
  v_total := v_subtotal - v_discount;

  insert into public.sales (user_id, payment_method, subtotal, discount, total)
  values (v_uid, p_payment_method, v_subtotal, v_discount, v_total)
  returning id, sale_number, created_at into v_sale_id, v_sale_number, v_created_at;

  insert into public.sale_items (
    sale_id, product_id, variant_id, product_name, variant_name, quantity, unit_price, unit_cost
  )
  select
    v_sale_id,
    (line ->> 'product_id')::uuid,
    nullif(line ->> 'variant_id', '')::uuid,
    line ->> 'product_name',
    line ->> 'variant_name',
    (line ->> 'quantity')::numeric,
    (line ->> 'unit_price')::numeric,
    (line ->> 'unit_cost')::numeric
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

create or replace function private.void_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sale public.sales;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_movement public.inventory_movements;
begin
  if (select private.current_app_role()) is distinct from 'admin'::public.app_role then
    raise exception 'Solo un administrador puede anular ventas';
  end if;

  if char_length(v_reason) < 3 then
    raise exception 'Escribe el motivo de la anulación';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id
  for update;

  if not found then
    raise exception 'Venta no encontrada';
  end if;

  if v_sale.status = 'anulada' then
    raise exception 'La venta ya está anulada';
  end if;

  perform 1
  from public.inventory_items
  where id in (
    select inventory_item_id
    from public.inventory_movements
    where sale_id = p_sale_id and reason = 'venta'
  )
  order by id
  for update;

  for v_movement in
    select *
    from public.inventory_movements
    where sale_id = p_sale_id and reason = 'venta'
    order by inventory_item_id
  loop
    update public.inventory_items
    set stock = stock - v_movement.change
    where id = v_movement.inventory_item_id;

    insert into public.inventory_movements (
      inventory_item_id, sale_id, change, reason, user_id, note
    ) values (
      v_movement.inventory_item_id,
      p_sale_id,
      -v_movement.change,
      'anulacion',
      v_uid,
      v_reason
    );
  end loop;

  update public.sales
  set
    status = 'anulada',
    void_reason = v_reason,
    voided_at = now(),
    voided_by = v_uid
  where id = p_sale_id;

  return jsonb_build_object('sale_id', p_sale_id, 'status', 'anulada');
end;
$$;

create or replace function private.adjust_inventory(
  p_item_id uuid,
  p_reason public.movement_reason,
  p_new_stock numeric default null,
  p_delta numeric default null,
  p_note text default null,
  p_unit_cost numeric default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item public.inventory_items;
  v_delta numeric;
  v_cost numeric;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if (select private.current_app_role()) is distinct from 'admin'::public.app_role then
    raise exception 'Solo un administrador puede ajustar el inventario';
  end if;

  if p_reason not in ('ajuste', 'compra') then
    raise exception 'Motivo inválido';
  end if;

  if p_new_stock is not null and p_delta is not null then
    raise exception 'Indica el stock nuevo o la cantidad, no ambos';
  end if;

  if p_reason = 'compra' and p_new_stock is not null then
    raise exception 'Una compra suma cantidad; no reemplaza el stock';
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'Insumo no encontrado';
  end if;

  if p_new_stock is not null then
    v_delta := p_new_stock - v_item.stock;
  elsif p_delta is not null then
    v_delta := p_delta;
  else
    v_delta := 0;
  end if;

  if p_reason = 'compra' and v_delta <= 0 then
    raise exception 'La compra debe ser mayor a cero';
  end if;

  v_cost := v_item.unit_cost;
  if p_unit_cost is not null then
    if p_unit_cost < 0 then
      raise exception 'El costo no puede ser negativo';
    end if;
    if p_reason = 'compra' and v_delta > 0 and v_item.stock > 0 and (v_item.stock + v_delta) > 0 then
      v_cost := ((v_item.stock * v_item.unit_cost) + (v_delta * p_unit_cost)) / (v_item.stock + v_delta);
    else
      v_cost := p_unit_cost;
    end if;
  end if;

  if v_delta = 0 and v_cost = v_item.unit_cost then
    raise exception 'Nada que actualizar';
  end if;

  update public.inventory_items
  set
    stock = stock + v_delta,
    unit_cost = round(v_cost, 4)
  where id = p_item_id
  returning * into v_item;

  if v_delta <> 0 then
    insert into public.inventory_movements (
      inventory_item_id, change, reason, user_id, note
    ) values (
      p_item_id, v_delta, p_reason, v_uid, v_note
    );
  end if;

  return v_item;
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
        si.quantity * si.unit_price * case
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

create or replace function private.replace_recipe(
  p_product_id uuid,
  p_variant_id uuid,
  p_items jsonb
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_inventory_id uuid;
  v_qty numeric;
  v_seen uuid[] := '{}';
  v_cost numeric := 0;
  v_unit_cost numeric;
begin
  if (select private.current_app_role()) is distinct from 'admin'::public.app_role then
    raise exception 'Solo un administrador puede editar recetas';
  end if;

  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Producto no encontrado';
  end if;

  if p_variant_id is not null and not exists (
    select 1
    from public.product_variants
    where id = p_variant_id and product_id = p_product_id
  ) then
    raise exception 'El sabor no pertenece al producto';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Receta inválida';
  end if;

  delete from public.recipe_items
  where product_id = p_product_id
    and variant_id is not distinct from p_variant_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_inventory_id := (v_item ->> 'inventory_item_id')::uuid;
      v_qty := round((v_item ->> 'quantity')::numeric, 4);
    exception
      when invalid_text_representation then
        raise exception 'Insumo o cantidad inválidos';
    end;

    if v_qty is null or v_qty <= 0 then
      raise exception 'La cantidad de la receta debe ser mayor a cero';
    end if;

    if v_inventory_id = any (v_seen) then
      raise exception 'El insumo está repetido en la receta';
    end if;
    v_seen := array_append(v_seen, v_inventory_id);

    select unit_cost into v_unit_cost
    from public.inventory_items
    where id = v_inventory_id;

    if not found then
      raise exception 'Insumo no encontrado';
    end if;

    insert into public.recipe_items (product_id, variant_id, inventory_item_id, quantity)
    values (p_product_id, p_variant_id, v_inventory_id, v_qty);

    v_cost := v_cost + (v_qty * v_unit_cost);
  end loop;

  return round(v_cost, 4);
end;
$$;

create or replace function public.create_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_discount numeric
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_sale(p_items, p_payment_method, p_discount);
$$;

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.void_sale(p_sale_id, p_reason);
$$;

create or replace function public.adjust_inventory(
  p_item_id uuid,
  p_reason public.movement_reason,
  p_new_stock numeric default null,
  p_delta numeric default null,
  p_note text default null,
  p_unit_cost numeric default null
)
returns public.inventory_items
language sql
security invoker
set search_path = ''
as $$
  select * from private.adjust_inventory(
    p_item_id, p_reason, p_new_stock, p_delta, p_note, p_unit_cost
  );
$$;

create or replace function public.get_kpis(p_from date, p_to date)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_kpis(p_from, p_to);
$$;

create or replace function public.replace_recipe(
  p_product_id uuid,
  p_variant_id uuid,
  p_items jsonb
)
returns numeric
language sql
security invoker
set search_path = ''
as $$
  select private.replace_recipe(p_product_id, p_variant_id, p_items);
$$;

revoke all on function private.recipe_for(uuid, uuid) from public, anon, authenticated;
revoke all on function private.create_sale(jsonb, public.payment_method, numeric) from public, anon;
revoke all on function private.void_sale(uuid, text) from public, anon;
revoke all on function private.adjust_inventory(uuid, public.movement_reason, numeric, numeric, text, numeric) from public, anon;
revoke all on function private.get_kpis(date, date) from public, anon;
revoke all on function private.replace_recipe(uuid, uuid, jsonb) from public, anon;

grant execute on function private.create_sale(jsonb, public.payment_method, numeric) to authenticated;
grant execute on function private.void_sale(uuid, text) to authenticated;
grant execute on function private.adjust_inventory(uuid, public.movement_reason, numeric, numeric, text, numeric) to authenticated;
grant execute on function private.get_kpis(date, date) to authenticated;
grant execute on function private.replace_recipe(uuid, uuid, jsonb) to authenticated;

revoke all on function public.create_sale(jsonb, public.payment_method, numeric) from public, anon;
revoke all on function public.void_sale(uuid, text) from public, anon;
revoke all on function public.adjust_inventory(uuid, public.movement_reason, numeric, numeric, text, numeric) from public, anon;
revoke all on function public.get_kpis(date, date) from public, anon;
revoke all on function public.replace_recipe(uuid, uuid, jsonb) from public, anon;

grant execute on function public.create_sale(jsonb, public.payment_method, numeric) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.adjust_inventory(uuid, public.movement_reason, numeric, numeric, text, numeric) to authenticated;
grant execute on function public.get_kpis(date, date) to authenticated;
grant execute on function public.replace_recipe(uuid, uuid, jsonb) to authenticated;
