-- Quita el insumo de ejemplo que no se pudo borrar al cargar el menú real
-- porque ya tenía ajustes manuales.

delete from public.inventory_movements
where inventory_item_id = 'a1111111-1111-4111-8111-111111111105'
  and reason = 'ajuste'
  and sale_id is null;

delete from public.inventory_items
where id = 'a1111111-1111-4111-8111-111111111105'
  and name = 'Cerveza Pilsener'
  and not exists (
    select 1
    from public.recipe_items as ri
    where ri.inventory_item_id = inventory_items.id
  )
  and not exists (
    select 1
    from public.inventory_movements as m
    where m.inventory_item_id = inventory_items.id
  );
