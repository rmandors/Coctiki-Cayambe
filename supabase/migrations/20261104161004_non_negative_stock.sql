-- El inventario no puede quedar negativo.
-- Los negativos actuales pasan a cero con un ajuste. Ventas y sus ítems no se tocan.

insert into public.inventory_movements (inventory_item_id, change, reason, note)
select
  id,
  -stock,
  'ajuste',
  'Stock negativo llevado a cero. El historial de ventas no se modifica.'
from public.inventory_items
where stock < 0;

update public.inventory_items
set stock = 0
where stock < 0;

alter table public.inventory_items
  add constraint inventory_items_stock_nonnegative check (stock >= 0);
