import { roundMoney } from '@/lib/format.ts'

export type PriceTier = {
  quantity: number
  total: number
}

export function bundleTotal(basePrice: number, quantity: number, tiers: PriceTier[]) {
  if (quantity <= 0) return 0
  if (!Number.isInteger(quantity) || tiers.length === 0) return roundMoney(basePrice * quantity)

  const packs = new Map<number, number>()
  packs.set(1, Math.round(basePrice * 100))
  for (const tier of tiers) {
    if (tier.quantity > 0) packs.set(tier.quantity, Math.round(tier.total * 100))
  }

  const dp: Array<number | null> = Array(quantity + 1).fill(null)
  dp[0] = 0
  for (let amount = 1; amount <= quantity; amount += 1) {
    for (const [size, cost] of packs) {
      const previous = amount >= size ? dp[amount - size] : null
      if (previous === null) continue
      const next = previous + cost
      const current = dp[amount]
      if (current === null || next < current) dp[amount] = next
    }
  }

  const cents = dp[quantity]
  if (cents === null) return roundMoney(basePrice * quantity)
  return cents / 100
}

export function tierLabel(basePrice: number, tiers: PriceTier[], format: (value: number) => string) {
  const ordered = [...tiers].filter((tier) => tier.quantity > 1).sort((a, b) => a.quantity - b.quantity)
  if (ordered.length === 0) return format(basePrice)
  return [`1 ${format(basePrice)}`, ...ordered.map((tier) => `${tier.quantity} ${format(tier.total)}`)].join(' · ')
}

export function priceLines<T extends { key: string; productId: string; quantity: number; unitPrice: number }>(
  lines: T[],
  pricing: Map<string, { basePrice: number; tiers: PriceTier[] }>,
) {
  const groups = new Map<string, T[]>()
  for (const line of lines) {
    const group = groups.get(line.productId) ?? []
    group.push(line)
    groups.set(line.productId, group)
  }

  const charges = new Map<string, number>()

  for (const [productId, group] of groups) {
    const rule = pricing.get(productId)
    const list = roundMoney(group.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0))
    const whole = group.every((line) => Number.isInteger(line.quantity))
    const units = group.reduce((sum, line) => sum + line.quantity, 0)
    const bundle = rule && rule.tiers.length > 0 && whole ? bundleTotal(rule.basePrice, units, rule.tiers) : list
    const cents = Math.round(bundle * 100)
    const base = units > 0 ? Math.floor(cents / units) : 0
    let extra = units > 0 ? cents - base * units : 0
    for (const line of group) {
      let lineCents = 0
      for (let unit = 0; unit < line.quantity; unit += 1) {
        lineCents += base + (extra > 0 ? 1 : 0)
        if (extra > 0) extra -= 1
      }
      if (!whole || !rule || rule.tiers.length === 0) {
        charges.set(line.key, roundMoney(line.unitPrice * line.quantity))
      } else {
        charges.set(line.key, lineCents / 100)
      }
    }
  }

  const priced = lines.map((line) => ({
    ...line,
    charge: charges.get(line.key) ?? roundMoney(line.unitPrice * line.quantity),
  }))

  return {
    lines: priced,
    subtotal: roundMoney(priced.reduce((sum, line) => sum + line.charge, 0)),
  }
}
