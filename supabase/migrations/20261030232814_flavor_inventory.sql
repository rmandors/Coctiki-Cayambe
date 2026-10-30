-- Cada sabor tiene su galón (lo descuentan las jarras) y su botella Coctiki.

insert into public.inventory_items (id, name, unit, stock, min_stock, unit_cost)
select
  ('a2222222-2222-4222-8222-222222222' || lpad((300 + right(v.id::text, 2)::integer)::text, 3, '0'))::uuid,
  'Galón · ' || v.name,
  'galon',
  0,
  0,
  0
from public.product_variants as v
where v.product_id = 'b2222222-2222-4222-8222-222222222201'
on conflict (id) do nothing;

insert into public.inventory_items (id, name, unit, stock, min_stock, unit_cost)
select
  ('a2222222-2222-4222-8222-222222222' || lpad((400 + right(v.id::text, 2)::integer)::text, 3, '0'))::uuid,
  'Botella Coctiki · ' || v.name,
  'unidad',
  0,
  0,
  0
from public.product_variants as v
where v.product_id = 'b2222222-2222-4222-8222-222222222202'
on conflict (id) do nothing;

insert into public.recipe_items (id, product_id, variant_id, inventory_item_id, quantity)
select
  ('d2222222-2222-4222-8222-222222222' || lpad((300 + right(v.id::text, 2)::integer)::text, 3, '0'))::uuid,
  v.product_id,
  v.id,
  ('a2222222-2222-4222-8222-222222222' || lpad((300 + right(v.id::text, 2)::integer)::text, 3, '0'))::uuid,
  0.1667
from public.product_variants as v
where v.product_id = 'b2222222-2222-4222-8222-222222222201'
on conflict (id) do nothing;

insert into public.recipe_items (id, product_id, variant_id, inventory_item_id, quantity)
select
  ('d2222222-2222-4222-8222-222222222' || lpad((400 + right(v.id::text, 2)::integer)::text, 3, '0'))::uuid,
  v.product_id,
  v.id,
  ('a2222222-2222-4222-8222-222222222' || lpad((400 + right(v.id::text, 2)::integer)::text, 3, '0'))::uuid,
  1
from public.product_variants as v
where v.product_id = 'b2222222-2222-4222-8222-222222222202'
on conflict (id) do nothing;

-- La venta ya registrada descontó el galón compartido. Pasa ese descuento al sabor vendido.
insert into public.inventory_movements (inventory_item_id, sale_id, change, reason, user_id, note, created_at)
select
  gallon.id,
  si.sale_id,
  -round(0.1667 * si.quantity, 4),
  'venta',
  shared.user_id,
  shared.note,
  shared.created_at
from public.sale_items as si
join public.inventory_items as gallon on gallon.name = 'Galón · ' || si.variant_name
join public.inventory_movements as shared
  on shared.sale_id = si.sale_id
 and shared.inventory_item_id = 'a2222222-2222-4222-8222-222222222201'
where si.product_id = 'b2222222-2222-4222-8222-222222222201'
  and si.variant_name is not null;

update public.inventory_items as ii
set stock = coalesce((
  select sum(m.change)
  from public.inventory_movements as m
  where m.inventory_item_id = ii.id
), 0)
where ii.name like 'Galón · %';

delete from public.inventory_movements
where inventory_item_id = 'a2222222-2222-4222-8222-222222222201';

delete from public.recipe_items
where product_id in (
  'b2222222-2222-4222-8222-222222222201',
  'b2222222-2222-4222-8222-222222222202'
)
and variant_id is null;

delete from public.inventory_items
where id in (
  'a2222222-2222-4222-8222-222222222201',
  'a2222222-2222-4222-8222-222222222202'
);
