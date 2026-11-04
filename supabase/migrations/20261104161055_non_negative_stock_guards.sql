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

  if round(v_item.stock + v_delta, 4) < 0 then
    raise exception 'El stock no puede quedar negativo';
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


create or replace function private.pos_ingredients()
returns table (
  product_id uuid,
  variant_id uuid,
  inventory_item_id uuid,
  item_name text,
  unit public.inventory_unit,
  stock numeric,
  min_stock numeric,
  per_unit numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id as product_id,
    opt.variant_id,
    ii.id as inventory_item_id,
    ii.name as item_name,
    ii.unit,
    ii.stock,
    ii.min_stock,
    ri.quantity as per_unit
  from public.products as p
  join lateral (
    select v.id as variant_id
    from public.product_variants as v
    where p.requires_variant
      and v.product_id = p.id
      and v.active
    union all
    select null::uuid as variant_id
    where not p.requires_variant
  ) as opt on true
  join lateral private.recipe_for(p.id, opt.variant_id) as ri on true
  join public.inventory_items as ii on ii.id = ri.inventory_item_id
  where p.active
    and (select private.current_app_role()) is not null;
$$;

create or replace function public.pos_ingredients()
returns table (
  product_id uuid,
  variant_id uuid,
  inventory_item_id uuid,
  item_name text,
  unit public.inventory_unit,
  stock numeric,
  min_stock numeric,
  per_unit numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.pos_ingredients();
$$;

revoke all on function private.pos_ingredients() from public, anon;
grant execute on function private.pos_ingredients() to authenticated;

revoke all on function public.pos_ingredients() from public, anon;
grant execute on function public.pos_ingredients() to authenticated;
