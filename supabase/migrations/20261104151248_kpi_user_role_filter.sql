-- Indicadores filtrables por usuario y por puesto (cajero o boletería).

drop function if exists public.get_kpis(date, date);
drop function if exists private.get_kpis(date, date);

create function private.get_kpis(
  p_from date,
  p_to date,
  p_user_id uuid default null,
  p_role public.app_role default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_users uuid[];
  v_count bigint;
  v_revenue numeric;
  v_discounts numeric;
  v_cost numeric;
  v_by_day jsonb;
  v_by_payment jsonb;
  v_top jsonb;
begin
  if (select private.current_app_role()) is distinct from 'admin'::public.app_role then
    raise exception 'Solo un administrador puede ver los indicadores';
  end if;

  if p_from is null or p_to is null then
    raise exception 'Indica el rango de fechas';
  end if;

  if p_to < p_from then
    raise exception 'La fecha final es anterior a la inicial';
  end if;

  if p_to - p_from > 366 then
    raise exception 'El rango máximo es de un año';
  end if;

  if p_role is not null and p_role not in ('cajero'::public.app_role, 'portero'::public.app_role) then
    raise exception 'El filtro de puesto solo admite cajero o boletería';
  end if;

  if p_user_id is null and p_role is null then
    v_users := null;
  elsif p_user_id is not null and p_role is null then
    v_users := array[p_user_id];
  else
    select coalesce(array_agg(id), '{}'::uuid[])
    into v_users
    from public.profiles
    where (p_user_id is null or id = p_user_id)
      and role = p_role;
  end if;

  v_start := (p_from::timestamp) at time zone 'America/Guayaquil';
  v_end := ((p_to + 1)::timestamp) at time zone 'America/Guayaquil';

  select
    count(*),
    coalesce(sum(s.total), 0),
    coalesce(sum(s.discount), 0)
  into v_count, v_revenue, v_discounts
  from public.sales as s
  where s.status = 'completada'
    and s.created_at >= v_start
    and s.created_at < v_end
    and (v_users is null or s.user_id = any (v_users));

  select coalesce(sum(si.quantity * si.unit_cost), 0)
  into v_cost
  from public.sale_items as si
  join public.sales as s on s.id = si.sale_id
  where s.status = 'completada'
    and s.created_at >= v_start
    and s.created_at < v_end
    and (v_users is null or s.user_id = any (v_users));

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day', to_char(d.day, 'YYYY-MM-DD'),
      'revenue', round(d.revenue, 2),
      'cost', round(d.cost, 2),
      'sales_count', d.sales_count
    )
    order by d.day
  ), '[]'::jsonb)
  into v_by_day
  from (
    select
      gs::date as day,
      coalesce(sum(s.total), 0) as revenue,
      coalesce(sum(ic.cost), 0) as cost,
      count(s.id) as sales_count
    from generate_series(p_from, p_to, interval '1 day') as gs
    left join public.sales as s
      on s.status = 'completada'
      and (s.created_at at time zone 'America/Guayaquil')::date = gs::date
      and (v_users is null or s.user_id = any (v_users))
    left join lateral (
      select coalesce(sum(si.quantity * si.unit_cost), 0) as cost
      from public.sale_items as si
      where si.sale_id = s.id
    ) as ic on true
    group by gs::date
  ) as d;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'method', p.payment_method,
      'revenue', round(p.revenue, 2),
      'sales_count', p.sales_count
    )
  ), '[]'::jsonb)
  into v_by_payment
  from (
    select s.payment_method, sum(s.total) as revenue, count(*) as sales_count
    from public.sales as s
    where s.status = 'completada'
      and s.created_at >= v_start
      and s.created_at < v_end
      and (v_users is null or s.user_id = any (v_users))
    group by s.payment_method
  ) as p;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', t.product_name,
      'variant', t.variant_name,
      'quantity', t.quantity,
      'revenue', round(t.revenue, 2),
      'cost', round(t.cost, 2)
    )
    order by t.revenue desc
  ), '[]'::jsonb)
  into v_top
  from (
    select
      si.product_name,
      si.variant_name,
      sum(si.quantity) as quantity,
      sum(
        si.line_total * case
          when s.subtotal = 0 then 0
          else s.total / s.subtotal
        end
      ) as revenue,
      sum(si.quantity * si.unit_cost) as cost
    from public.sale_items as si
    join public.sales as s on s.id = si.sale_id
    where s.status = 'completada'
      and s.created_at >= v_start
      and s.created_at < v_end
      and (v_users is null or s.user_id = any (v_users))
    group by si.product_name, si.variant_name
    order by revenue desc
    limit 8
  ) as t;

  return jsonb_build_object(
    'sales_count', v_count,
    'revenue', round(v_revenue, 2),
    'discounts', round(v_discounts, 2),
    'cost', round(v_cost, 2),
    'profit', round(v_revenue - v_cost, 2),
    'margin_pct', case
      when v_revenue = 0 then 0
      else round((v_revenue - v_cost) / v_revenue * 100, 1)
    end,
    'avg_ticket', case
      when v_count = 0 then 0
      else round(v_revenue / v_count, 2)
    end,
    'by_day', v_by_day,
    'by_payment', v_by_payment,
    'top_products', v_top
  );
end;
$$;

create function public.get_kpis(
  p_from date,
  p_to date,
  p_user_id uuid default null,
  p_role public.app_role default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_kpis(p_from, p_to, p_user_id, p_role);
$$;

revoke all on function private.get_kpis(date, date, uuid, public.app_role) from public, anon;
grant execute on function private.get_kpis(date, date, uuid, public.app_role) to authenticated;

revoke all on function public.get_kpis(date, date, uuid, public.app_role) from public, anon;
grant execute on function public.get_kpis(date, date, uuid, public.app_role) to authenticated;
