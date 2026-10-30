# Coctiki

Registro interno de ventas, inventario e indicadores del bar Coctiki, en Cayambe. No emite facturas electrónicas del SRI: cada venta es un comprobante interno, con método de pago, descuento y la posibilidad de anularla.

El dinero está en dólares y las fechas se calculan en hora de Ecuador (`America/Guayaquil`).

## Quién entra

Las cuentas las crea un administrador. No hay registro público.

| Rol | Qué ve |
| --- | --- |
| Cajero | Facturación del menú. No ve entrada, barra libre ni el historial. |
| Portero | Facturación, solo entrada y barra libre. |
| Administrador | Todo: menú completo, ventas, inventario, indicadores, catálogo y usuarios. |

El rol vive en la base de datos, no en datos que el usuario pueda editar. Un cajero o un portero no pueden vender un producto que no está en su menú: la pantalla lo oculta y la base lo rechaza.

## Secciones

**Facturación.** Grilla del menú. Si el producto pide sabor, se elige antes de agregarlo. La cuenta lleva cantidad, descuento (monto o porcentaje) y pago en efectivo, transferencia o tarjeta. Al registrar, se imprime un comprobante interno. Si el stock queda en cero o negativo, la venta igual se guarda y el comprobante avisa.

**Ventas.** Historial del día. El administrador puede anular una venta; al anularla, el inventario vuelve.

**Inventario.** Stock por insumo, con aviso si está bajo o negativo. Un ajuste deja el stock en un número. Una compra suma cantidad y, si ya había stock, promedia el costo. Abajo queda el movimiento de cada cambio.

**Indicadores.** Ventas completadas de un rango de fechas: ingreso después del descuento, costo, margen, ticket promedio, y gráficos por día, método de pago y producto.

**Catálogo.** Productos, sabores, precios por cantidad, recetas e insumos. «Solo portería» marca lo que vende el portero (entrada y barra libre).

**Usuarios.** Alta con correo y contraseña, cambio de nombre, de rol y de estado, y eliminación. Nadie puede borrarse ni cambiarse el rol a sí mismo.

## Cómo se vende y cómo se descuenta

Una jarra o una botella Coctiki cuesta $8. Dos, aunque sean de sabores distintos, cuestan $15. Tres cuestan $20. De cuatro en adelante se arma con esos paquetes: cuatro salen a $28, cinco a $35 y seis a $40. En el menú se ve el precio de una; la promo aparece al elegir el producto.

Una jarra descuenta 0.1667 galón de preparado, porque un galón rinde seis jarras. Una botella, una lata o un cigarrillo descuentan una unidad de su propio insumo. Entrada y barra libre se cobran y no mueven el inventario. El costo de la receta se guarda en la línea de la venta y no cambia si después cambia el costo del insumo.

El margen de los indicadores compara lo cobrado, ya con descuento, contra ese costo guardado. El catálogo muestra aparte el margen teórico con los costos de hoy.

## Arquitectura

La interfaz es una aplicación React con Vite, TypeScript y Tailwind. Cada sección es una ruta. La navegación y las rutas dependen del rol.

Supabase guarda los datos y las sesiones. Postgres aplica las reglas de acceso por rol. Las operaciones que no pueden quedar a medias viven en funciones de la base, no en el navegador:

- registrar una venta y descontar el inventario
- anular una venta y devolver el stock
- ajustar o comprar inventario
- reemplazar una receta
- calcular los indicadores

Crear o eliminar una cuenta pasa por una función de Supabase que solo acepta a un administrador activo. El navegador nunca recibe la clave de servicio.
