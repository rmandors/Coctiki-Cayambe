-- El stock cargado sin sabor no se reparte. Quedan solo las botellas por sabor.

delete from public.inventory_movements
where inventory_item_id = 'a2222222-2222-4222-8222-222222222202';

delete from public.inventory_items
where id = 'a2222222-2222-4222-8222-222222222202';
