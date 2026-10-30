-- Nota opcional al facturar. La escribe cualquier rol activo.

alter table public.sales
  add column note text;

alter table public.sales
  add constraint sales_note_length check (note is null or char_length(note) <= 300);

create function private.set_sale_note(p_sale_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'La nota no puede pasar de 300 caracteres';
  end if;

  update public.sales
  set note = v_note
  where id = p_sale_id;

  if not found then
    raise exception 'No se encontró la venta';
  end if;
end;
$$;

drop function public.create_sale(jsonb, public.payment_method, numeric);

create function public.create_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_discount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := private.create_sale(p_items, p_payment_method, p_discount);
  perform private.set_sale_note((v_result ->> 'sale_id')::uuid, p_note);
  return v_result;
end;
$$;

revoke all on function private.set_sale_note(uuid, text) from public, anon;
grant execute on function private.set_sale_note(uuid, text) to authenticated;

revoke all on function public.create_sale(jsonb, public.payment_method, numeric, text) from public, anon;
grant execute on function public.create_sale(jsonb, public.payment_method, numeric, text) to authenticated;
