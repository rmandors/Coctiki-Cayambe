# Coctiki

Punto de venta, inventario e indicadores para Coctiki (Cayambe).

- **Cajero:** facturación y sus propias ventas.
- **Administrador:** facturación, ventas (puede anular), inventario, indicadores, catálogo y usuarios.

Registrar una venta descuenta el inventario según la receta. Una jarra puede decir “1 galón rinde 5”: cada venta descuenta 0.2 galón. Un producto terminado, como una cerveza, es una receta de 1 unidad.

## Requisitos

- Node.js 22+
- Un proyecto en [Supabase](https://supabase.com)
- Una cuenta en [Vercel](https://vercel.com) para publicar

## 1. Base de datos

En la carpeta del proyecto, con la [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
npx supabase functions deploy admin-create-user
```

`db push` crea las tablas, las reglas de acceso y un menú de ejemplo (jarras, cerveza y canelazo).

En el panel de Supabase, en Authentication, desactiva los registros públicos. Las cuentas las crea un administrador desde la app. La CLI local ya deja `enable_signup = false` en `supabase/config.toml`; el proyecto alojado hay que cerrarlo en el panel.

### Primer administrador

1. En Authentication → Users, crea un usuario con correo y contraseña.
2. En el SQL Editor:

```sql
update public.profiles
set role = 'admin', full_name = 'Administrador'
where email = 'tu-correo@ejemplo.com';
```

Ese usuario ya puede crear cajeros y otros administradores en Usuarios.

## 2. App en local

```bash
cp .env.example .env
```

Completa `.env` con la URL del proyecto y la clave anónima (o publishable) de Settings → API Keys. No uses la clave `service_role` en el frontend.

```bash
npm install
npm run dev
```

## Cómo se calcula el margen

Cada venta guarda el costo de la receta en ese momento. Los indicadores comparan lo cobrado (después del descuento) con ese costo. El menú actual muestra el margen teórico con los costos de hoy.

Si el stock queda en cero o negativo, la venta igual se registra y el comprobante avisa. El conteo manual y las compras están en Inventario.
