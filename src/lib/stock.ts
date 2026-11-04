import { formatStock } from '@/lib/format.ts'
import type { InventoryUnit } from '@/lib/types.ts'

export type StockTone = 'agotado' | 'bajo'

export type PosIngredient = {
  product_id: string
  variant_id: string | null
  inventory_item_id: string
  item_name: string
  unit: InventoryUnit
  stock: number
  min_stock: number
  per_unit: number
}

type SaleLine = {
  productId: string
  variantId: string | null
  quantity: number
}

function roundQty(value: number) {
  return Math.round(value * 10000) / 10000
}

export function stockLabel(tone: StockTone | null) {
  if (tone === 'agotado') return 'Agotado'
  if (tone === 'bajo') return 'Stock bajo'
  return null
}

function ingredientsFor(rows: PosIngredient[], productId: string, variantId: string | null) {
  return rows.filter((row) => row.product_id === productId && (row.variant_id ?? null) === variantId)
}

export function stockTone(
  rows: PosIngredient[],
  productId: string,
  variantId: string | null,
  lowStockAt: number,
): StockTone | null {
  const ingredients = ingredientsFor(rows, productId, variantId)
  if (ingredients.length === 0) return null
  const canSellOne = ingredients.every((item) => roundQty(item.stock) + 0.00005 >= roundQty(item.per_unit))
  if (!canSellOne || ingredients.some((item) => item.stock <= 0)) return 'agotado'
  const servings = Math.min(...ingredients.map((item) => item.stock / item.per_unit))
  if (lowStockAt > 0 && servings <= lowStockAt + 0.00005) return 'bajo'
  return null
}

export function shortageMessage(rows: PosIngredient[], lines: SaleLine[]) {
  const need = new Map<string, { need: number; stock: number; name: string; unit: InventoryUnit }>()
  for (const line of lines) {
    for (const item of ingredientsFor(rows, line.productId, line.variantId)) {
      const current = need.get(item.inventory_item_id) ?? {
        need: 0,
        stock: item.stock,
        name: item.item_name,
        unit: item.unit,
      }
      current.need += item.per_unit * line.quantity
      need.set(item.inventory_item_id, current)
    }
  }
  const short = [...need.values()].filter((item) => roundQty(item.need) > roundQty(item.stock) + 0.00005)
  if (short.length === 0) return null
  const detail = short
    .map((item) => `${item.name}: hay ${formatStock(item.stock, item.unit)} y esta venta usa ${formatStock(roundQty(item.need), item.unit)}`)
    .join('. ')
  return `No hay stock suficiente. ${detail}.`
}
