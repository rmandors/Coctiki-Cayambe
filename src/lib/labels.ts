import type { AppRole, MovementReason, PaymentMethod, SaleStatus } from '@/lib/types.ts'

export const paymentLabels: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
}

export const roleLabels: Record<AppRole, string> = {
  cajero: 'Cajero',
  portero: 'Portero',
  admin: 'Administrador',
}

export const saleStatusLabels: Record<SaleStatus, string> = {
  completada: 'Completada',
  anulada: 'Anulada',
}

export const movementLabels: Record<MovementReason, string> = {
  venta: 'Venta',
  anulacion: 'Anulación',
  ajuste: 'Ajuste',
  compra: 'Compra',
}

export const unitOptions = [
  { value: 'galon', label: 'Galón' },
  { value: 'litro', label: 'Litro' },
  { value: 'ml', label: 'Mililitro' },
  { value: 'kg', label: 'Kilogramo' },
  { value: 'g', label: 'Gramo' },
  { value: 'unidad', label: 'Unidad' },
] as const
