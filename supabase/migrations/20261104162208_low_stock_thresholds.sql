-- Umbral de stock bajo. En inventario vive en el insumo.
-- En facturación, cada producto avisa al quedar en esa cantidad de ventas o menos.
-- Entrada, barra libre y Halloween no descuentan stock.

alter table public.products
  add column low_stock_at numeric(14, 3) not null default 3;

alter table public.products
  add constraint products_low_stock_at_nonnegative check (low_stock_at >= 0);

update public.products
set low_stock_at = 0
where door_only;

update public.products
set low_stock_at = 3
where not door_only;

update public.inventory_items
set min_stock = case unit
  when 'unidad' then 3
  when 'galon' then 0.5
  when 'litro' then 1
  when 'ml' then 200
  when 'kg' then 0.5
  when 'g' then 100
  else min_stock
end
where min_stock = 0;
