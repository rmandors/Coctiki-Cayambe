-- La botella Coctiki se factura con sabor, pero el stock es uno solo.

insert into public.inventory_items (id, name, unit, stock, min_stock, unit_cost)
values ('a2222222-2222-4222-8222-222222222202', 'Botella Coctiki', 'unidad', 0, 0, 0)
on conflict (id) do nothing;

delete from public.recipe_items
where product_id = 'b2222222-2222-4222-8222-222222222202';

insert into public.recipe_items (id, product_id, variant_id, inventory_item_id, quantity)
values (
  'd2222222-2222-4222-8222-222222222202',
  'b2222222-2222-4222-8222-222222222202',
  null,
  'a2222222-2222-4222-8222-222222222202',
  1
)
on conflict (id) do nothing;

delete from public.inventory_items
where name like 'Botella Coctiki · %';
