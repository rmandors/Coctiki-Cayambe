import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageHeader } from '@/components/feedback.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { addDays, asNumber, errorMessage, formatDay, formatMoney, formatPercent, todayISO } from '@/lib/format.ts'
import { paymentLabels } from '@/lib/labels.ts'
import { supabase } from '@/lib/supabase.ts'
import type { InventoryItem, Kpis, PaymentMethod, Product, RecipeItem } from '@/lib/types.ts'

type Preset = 'hoy' | 'semana' | 'mes'

function parseKpis(data: unknown): Kpis {
  const row = data as Kpis
  return {
    sales_count: asNumber(row.sales_count),
    revenue: asNumber(row.revenue),
    discounts: asNumber(row.discounts),
    cost: asNumber(row.cost),
    profit: asNumber(row.profit),
    margin_pct: asNumber(row.margin_pct),
    avg_ticket: asNumber(row.avg_ticket),
    by_day: (row.by_day ?? []).map((day) => ({
      day: day.day,
      revenue: asNumber(day.revenue),
      cost: asNumber(day.cost),
      sales_count: asNumber(day.sales_count),
    })),
    by_payment: (row.by_payment ?? []).map((payment) => ({
      method: payment.method,
      revenue: asNumber(payment.revenue),
      sales_count: asNumber(payment.sales_count),
    })),
    top_products: (row.top_products ?? []).map((product) => ({
      name: product.name,
      variant: product.variant,
      quantity: asNumber(product.quantity),
      revenue: asNumber(product.revenue),
      cost: asNumber(product.cost),
    })),
  }
}

function recipeCost(
  productId: string,
  variantId: string | null,
  recipes: RecipeItem[],
  items: InventoryItem[],
) {
  const specific = recipes.filter((recipe) => recipe.product_id === productId && recipe.variant_id === variantId)
  const base = recipes.filter((recipe) => recipe.product_id === productId && recipe.variant_id === null)
  const used = variantId && specific.length > 0 ? specific : base
  return used.reduce((sum, recipe) => {
    const item = items.find((candidate) => candidate.id === recipe.inventory_item_id)
    return sum + recipe.quantity * (item?.unit_cost ?? 0)
  }, 0)
}

export function KpisPage() {
  const today = todayISO()
  const [preset, setPreset] = useState<Preset>('hoy')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)

  function applyPreset(next: Preset) {
    setPreset(next)
    const end = todayISO()
    if (next === 'hoy') {
      setFrom(end)
      setTo(end)
    } else if (next === 'semana') {
      setFrom(addDays(end, -6))
      setTo(end)
    } else {
      setFrom(`${end.slice(0, 8)}01`)
      setTo(end)
    }
  }

  const kpisQuery = useQuery({
    queryKey: ['kpis', from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_kpis', { p_from: from, p_to: to })
      if (error) throw new Error(error.message)
      return parseKpis(data)
    },
  })

  const catalogQuery = useQuery({
    queryKey: ['catalog-margins'],
    queryFn: async () => {
      const [productsRes, recipesRes, itemsRes] = await Promise.all([
        supabase.from('products').select('id, name, category, price, active, requires_variant, product_variants(id, name, price, active)').eq('active', true),
        supabase.from('recipe_items').select('id, product_id, variant_id, inventory_item_id, quantity'),
        supabase.from('inventory_items').select('id, name, unit, stock, min_stock, unit_cost, active, created_at'),
      ])
      if (productsRes.error) throw new Error(productsRes.error.message)
      if (recipesRes.error) throw new Error(recipesRes.error.message)
      if (itemsRes.error) throw new Error(itemsRes.error.message)
      return {
        products: (productsRes.data ?? []) as Product[],
        recipes: ((recipesRes.data ?? []) as RecipeItem[]).map((recipe) => ({ ...recipe, quantity: asNumber(recipe.quantity) })),
        items: ((itemsRes.data ?? []) as InventoryItem[]).map((item) => ({ ...item, stock: asNumber(item.stock), min_stock: asNumber(item.min_stock), unit_cost: asNumber(item.unit_cost) })),
      }
    },
  })

  const kpis = kpisQuery.data
  const chartDays = (kpis?.by_day ?? []).map((day) => ({ ...day, label: formatDay(day.day) }))
  const lowStock = (catalogQuery.data?.items ?? []).filter((item) => item.active && item.stock <= item.min_stock)

  const margins = useMemo(() => {
    if (!catalogQuery.data) return []
    const { products, recipes, items } = catalogQuery.data
    return products.flatMap((product) => {
      const price = asNumber(product.price)
      if (product.requires_variant) {
        return (product.product_variants ?? []).filter((variant) => variant.active).map((variant) => {
          const sell = variant.price === null ? price : asNumber(variant.price)
          const cost = recipeCost(product.id, variant.id, recipes, items)
          return { id: variant.id, label: `${product.name} · ${variant.name}`, price: sell, cost }
        })
      }
      const cost = recipeCost(product.id, null, recipes, items)
      return [{ id: product.id, label: product.name, price, cost }]
    })
  }, [catalogQuery.data])

  return (
    <div>
      <PageHeader
        title="Indicadores"
        description="Ventas cobradas contra el costo de la receta al momento de vender."
      />
      <div className="mb-5 flex flex-wrap items-end gap-2">
        {([['hoy', 'Hoy'], ['semana', '7 días'], ['mes', 'Este mes']] as const).map(([value, label]) => (
          <Button key={value} variant={preset === value ? 'default' : 'outline'} className="h-10" onClick={() => applyPreset(value)}>
            {label}
          </Button>
        ))}
        <div className="grid gap-1">
          <Label htmlFor="from">Desde</Label>
          <Input id="from" type="date" value={from} onChange={(event) => { setPreset('hoy'); setFrom(event.target.value) }} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="to">Hasta</Label>
          <Input id="to" type="date" value={to} onChange={(event) => { setPreset('hoy'); setTo(event.target.value) }} />
        </div>
      </div>
      {kpisQuery.isError ? <p className="mb-4 text-sm text-destructive">{errorMessage(kpisQuery.error)}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Ventas" value={formatMoney(kpis?.revenue ?? 0)} hint={`${kpis?.sales_count ?? 0} tickets`} />
        <KpiCard label="Costo" value={formatMoney(kpis?.cost ?? 0)} hint={`Descuentos ${formatMoney(kpis?.discounts ?? 0)}`} />
        <KpiCard label="Utilidad" value={formatMoney(kpis?.profit ?? 0)} hint={`Margen ${formatPercent(kpis?.margin_pct ?? 0)}`} />
        <KpiCard label="Ticket promedio" value={formatMoney(kpis?.avg_ticket ?? 0)} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-5">
        <section className="rounded-2xl border border-border bg-card p-4 xl:col-span-3">
          <h2 className="mb-3 font-medium">Ventas por día</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartDays}>
                <CartesianGrid stroke="oklch(0.85 0.04 80 / 16%)" vertical={false} />
                <XAxis dataKey="label" stroke="oklch(0.74 0.03 80)" fontSize={12} />
                <YAxis stroke="oklch(0.74 0.03 80)" fontSize={12} />
                <Tooltip formatter={(value) => formatMoney(asNumber(value))} />
                <Line type="monotone" dataKey="revenue" name="Venta" stroke="oklch(0.80 0.14 78)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cost" name="Costo" stroke="oklch(0.72 0.12 145)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-4 xl:col-span-2">
          <h2 className="mb-3 font-medium">Método de pago</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(kpis?.by_payment ?? []).map((payment) => ({ ...payment, label: paymentLabels[payment.method as PaymentMethod] ?? payment.method }))}>
                <CartesianGrid stroke="oklch(0.85 0.04 80 / 16%)" vertical={false} />
                <XAxis dataKey="label" stroke="oklch(0.74 0.03 80)" fontSize={12} />
                <YAxis stroke="oklch(0.74 0.03 80)" fontSize={12} />
                <Tooltip formatter={(value) => formatMoney(asNumber(value))} />
                <Bar dataKey="revenue" name="Venta" fill="oklch(0.80 0.14 78)" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 font-medium">Margen realizado</h2>
          <MarginTable
            rows={(kpis?.top_products ?? []).map((product) => ({
              id: `${product.name}-${product.variant ?? ''}`,
              label: product.variant ? `${product.name} · ${product.variant}` : product.name,
              price: product.revenue,
              cost: product.cost,
              priceLabel: 'Venta',
            }))}
            empty="Todavía no hay ventas en este rango."
          />
        </section>
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 font-medium">Margen del menú actual</h2>
          <p className="mb-3 text-xs text-muted-foreground">Precio de venta contra el costo de la receta con los costos de hoy.</p>
          <MarginTable
            rows={margins.map((row) => ({ ...row, priceLabel: 'Precio' }))}
            empty="No hay productos activos."
          />
        </section>
      </div>

      {lowStock.length > 0 ? (
        <section className="mt-5 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
          <h2 className="mb-2 font-medium">Stock bajo</h2>
          <ul className="grid gap-1 text-sm">
            {lowStock.map((item) => (
              <li key={item.id}>{item.name}: {item.stock} (mínimo {item.min_stock})</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-heading mt-1 text-3xl">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </article>
  )
}

function MarginTable({
  rows,
  empty,
}: {
  rows: { id: string; label: string; price: number; cost: number; priceLabel: string }[]
  empty: string
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">Producto</th>
            <th className="py-1 font-medium">{rows[0]?.priceLabel}</th>
            <th className="py-1 font-medium">Costo</th>
            <th className="py-1 font-medium">Margen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const profit = row.price - row.cost
            const margin = row.price === 0 ? 0 : (profit / row.price) * 100
            return (
              <tr key={row.id} className="border-t border-border">
                <td className="py-2 pr-2">{row.label}</td>
                <td className="py-2">{formatMoney(row.price)}</td>
                <td className="py-2">{formatMoney(row.cost)}</td>
                <td className="py-2">{formatPercent(margin)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
