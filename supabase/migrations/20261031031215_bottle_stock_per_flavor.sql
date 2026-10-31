-- Cada sabor de botella Coctiki vuelve a tener su propio stock.

insert into public.inventory_items (id, name, unit, stock, min_stock, unit_cost)
select
  ('a2222222-2222-4222-8222-222222222' || lpad((400 + right(v.id::text, 2)::integer)::text, 3, '0'))::uuid,
  'Botella Coctiki · ' || v.name,
  'unidad',
  0,
  0,
  shared.unit_cost
from public.product_variants as v
cross join public.inventory_items as shared
where v.product_id = 'b2222222-2222-4222-8222-222222222202'
  and shared.id = 'a2222222-2222-4222-8222-222222222202'
on conflict (id) do update
set name = excluded.name,
    unit_cost = excluded.unit_cost;

delete from public.recipe_items
where product_id = 'b2222222-2222-4222-8222-222222222202';

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

update public.inventory_items
set name = 'Botella Coctiki por repartir'
where id = 'a2222222-2222-4222-8222-222222222202'
  and name = 'Botella Coctiki';
