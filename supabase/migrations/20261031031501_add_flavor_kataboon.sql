-- Kataboon en jarras (galón) y en botella Coctiki.

insert into public.product_variants (id, product_id, name)
values
  ('c2222222-2222-4222-8222-222222222221', 'b2222222-2222-4222-8222-222222222201', 'Kataboon'),
  ('c2222222-2222-4222-8222-222222222321', 'b2222222-2222-4222-8222-222222222202', 'Kataboon')
on conflict (id) do nothing;

insert into public.inventory_items (id, name, unit, stock, min_stock, unit_cost)
values
  ('a2222222-2222-4222-8222-222222222321', 'Galón · Kataboon', 'galon', 0, 0, 0),
  ('a2222222-2222-4222-8222-222222222421', 'Botella Coctiki · Kataboon', 'unidad', 0, 0, 0)
on conflict (id) do nothing;

insert into public.recipe_items (id, product_id, variant_id, inventory_item_id, quantity)
values
  ('d2222222-2222-4222-8222-222222222321', 'b2222222-2222-4222-8222-222222222201', 'c2222222-2222-4222-8222-222222222221', 'a2222222-2222-4222-8222-222222222321', 0.1667),
  ('d2222222-2222-4222-8222-222222222421', 'b2222222-2222-4222-8222-222222222202', 'c2222222-2222-4222-8222-222222222321', 'a2222222-2222-4222-8222-222222222421', 1)
on conflict (id) do nothing;
