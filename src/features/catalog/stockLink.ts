import { supabase } from '@/lib/supabase.ts'
import type { InventoryUnit } from '@/lib/types.ts'

const pitchersPerGallon = 6

export function isJarra(category: string) {
  return category.trim().toLocaleLowerCase('es') === 'jarras'
}

async function recipeItemId(productId: string, variantId: string | null) {
  const query = supabase.from('recipe_items').select('inventory_item_id').eq('product_id', productId)
  const { data, error } = await (variantId ? query.eq('variant_id', variantId) : query.is('variant_id', null)).maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.inventory_item_id as string | undefined) ?? null
}

async function ensureItem(name: string, unit: InventoryUnit) {
  const { data: existing, error: lookupError } = await supabase.from('inventory_items').select('id').eq('name', name).maybeSingle()
  if (lookupError) throw new Error(lookupError.message)
  if (existing) return existing.id as string
  const { data, error } = await supabase.from('inventory_items').insert({
    name,
    unit,
    stock: 0,
    min_stock: 0,
    unit_cost: 0,
    active: true,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id as string
}

async function setRecipe(productId: string, variantId: string | null, inventoryId: string, quantity: number) {
  const { error } = await supabase.rpc('replace_recipe', {
    p_product_id: productId,
    p_variant_id: variantId,
    p_items: [{ inventory_item_id: inventoryId, quantity }],
  })
  if (error) throw new Error(error.message)
}

async function clearRecipe(productId: string, variantId: string | null) {
  const { error } = await supabase.rpc('replace_recipe', {
    p_product_id: productId,
    p_variant_id: variantId,
    p_items: [],
  })
  if (error) throw new Error(error.message)
}

export async function linkFinishedProduct(productId: string, name: string) {
  if (await recipeItemId(productId, null)) return
  const itemId = await ensureItem(name, 'unidad')
  await setRecipe(productId, null, itemId, 1)
}

export async function linkFlavor(productId: string, productName: string, category: string, variantId: string, variantName: string) {
  const jarra = isJarra(category)
  const stockName = jarra ? `Galón · ${variantName}` : `${productName} · ${variantName}`
  const linkedId = await recipeItemId(productId, variantId)
  const itemId = linkedId ?? await ensureItem(stockName, jarra ? 'galon' : 'unidad')
  if (linkedId) {
    const { error } = await supabase.from('inventory_items').update({ name: stockName }).eq('id', linkedId)
    if (error) throw new Error(error.message)
  }
  await setRecipe(productId, variantId, itemId, jarra ? 1 / pitchersPerGallon : 1)
}

export async function syncProductStock(input: {
  productId: string
  name: string
  category: string
  doorOnly: boolean
  requiresVariant: boolean
  variants: { id: string; name: string; active: boolean }[]
}) {
  if (input.doorOnly) {
    await clearRecipe(input.productId, null)
    for (const variant of input.variants) await clearRecipe(input.productId, variant.id)
    return
  }
  if (input.requiresVariant) {
    const active = input.variants.filter((variant) => variant.active)
    if (active.length > 0) await clearRecipe(input.productId, null)
    for (const variant of active) {
      if (await recipeItemId(input.productId, variant.id)) continue
      await linkFlavor(input.productId, input.name, input.category, variant.id, variant.name)
    }
    return
  }
  await linkFinishedProduct(input.productId, input.name)
}
