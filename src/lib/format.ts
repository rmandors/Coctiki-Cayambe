import type { InventoryUnit } from '@/lib/types.ts'

const money = new Intl.NumberFormat('es-EC', {
  style: 'currency',
  currency: 'USD',
})

const quantity = new Intl.NumberFormat('es-EC', {
  maximumFractionDigits: 3,
})

export function asNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

export function formatMoney(value: number) {
  return money.format(asNumber(value))
}

export function formatQty(value: number) {
  return quantity.format(asNumber(value))
}

export function formatPercent(value: number) {
  return `${asNumber(value).toLocaleString('es-EC', { maximumFractionDigits: 1 })}%`
}

export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
  }).format(new Date())
}

export function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00-05:00`)
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
  }).format(date)
}

export function dayBounds(isoDate: string) {
  const start = new Date(`${isoDate}T00:00:00-05:00`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export function formatDay(isoDate: string) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${isoDate}T12:00:00-05:00`))
}

export function formatStock(value: number, unit: InventoryUnit) {
  return `${formatQty(value)} ${unitLabel(unit)}`
}

export function unitLabel(unit: InventoryUnit) {
  const labels: Record<InventoryUnit, string> = {
    galon: 'gal',
    litro: 'L',
    ml: 'ml',
    kg: 'kg',
    g: 'g',
    unidad: 'u',
  }
  return labels[unit]
}

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message
  ) {
    return error.message
  }
  return 'Ocurrió un error inesperado'
}

export async function functionErrorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'context' in error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      const body = (await context.clone().json().catch(() => null)) as { error?: string } | null
      if (body?.error) return body.error
    }
  }
  return errorMessage(error)
}
