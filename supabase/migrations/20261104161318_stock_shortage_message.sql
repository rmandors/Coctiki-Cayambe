-- La alerta de stock no deja un punto suelto al final del número.

do $$
declare
  v_sql text := pg_get_functiondef('private.create_sale(jsonb, public.payment_method, numeric)'::regprocedure);
begin
  v_sql := replace(
    v_sql,
    'trim(to_char(short.stock, ''FM999999990.9999''))',
    'trim(trailing ''.'' from trim(to_char(short.stock, ''FM999999990.9999'')))'
  );
  v_sql := replace(
    v_sql,
    'trim(to_char(short.needed, ''FM999999990.9999''))',
    'trim(trailing ''.'' from trim(to_char(short.needed, ''FM999999990.9999'')))'
  );
  execute v_sql;
end $$;
