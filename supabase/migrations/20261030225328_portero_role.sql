-- El valor nuevo no se puede usar en la misma transacción en la que se crea.
alter type public.app_role add value if not exists 'portero';
