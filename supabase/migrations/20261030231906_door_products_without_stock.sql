-- Entrada y barra libre se cobran, pero no son insumos.

delete from public.recipe_items
where product_id in (
  'b2222222-2222-4222-8222-222222222215',
  'b2222222-2222-4222-8222-222222222216'
)
or inventory_item_id in (
  'a2222222-2222-4222-8222-222222222215',
  'a2222222-2222-4222-8222-222222222216'
);

delete from public.inventory_items
where id in (
  'a2222222-2222-4222-8222-222222222215',
  'a2222222-2222-4222-8222-222222222216'
);
