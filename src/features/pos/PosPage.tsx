import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Banknote, ChevronLeft, ChevronRight, CreditCard, Minus, Plus, Printer, Receipt } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider.tsx'
import { EmptyState } from '@/components/feedback.tsx'
import { Button } from '@/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { asNumber, errorMessage, formatDateTime, formatMoney, formatStock, roundMoney } from '@/lib/format.ts'
import { paymentLabels } from '@/lib/labels.ts'
import { bundleTotal, priceLines, promoLabel } from '@/lib/pricing.ts'
import { shortageMessage, stockLabel, stockTone, type PosIngredient, type StockTone } from '@/lib/stock.ts'
import { supabase } from '@/lib/supabase.ts'
import type { CartLine, PaymentMethod, Product, ProductVariant, SaleResult, StockWarning } from '@/lib/types.ts'

type DiscountMode = 'monto' | 'porcentaje'

type Receipt = {
  saleNumber: number
  createdAt: string
  lines: Array<CartLine & { charge: number }>
  subtotal: number
  discount: number
  total: number
  payment: PaymentMethod
  note: string
  warnings: StockWarning[]
}

const payments: { method: PaymentMethod; icon: typeof Banknote }[] = [
  { method: 'efectivo', icon: Banknote },
  { method: 'transferencia', icon: ArrowRightLeft },
  { method: 'tarjeta', icon: CreditCard },
]

function FlavorPages({
  flavors,
  flavorId,
  page,
  onPage,
  onPick,
  toneOf,
}: {
  flavors: ProductVariant[]
  flavorId: string | null
  page: number
  onPage: (page: number) => void
  onPick: (id: string) => void
  toneOf: (id: string) => ReturnType<typeof stockTone>
}) {
  const pageCount = flavors.length > 8 ? 2 : 1
  const pageSize = Math.ceil(flavors.length / pageCount)
  const current = Math.min(page, pageCount - 1)
  const visible = flavors.slice(current * pageSize, current * pageSize + pageSize)

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        {visible.map((variant) => {
          const tone = toneOf(variant.id)
          const label = stockLabel(tone)
          return (
            <button
              key={variant.id}
              type="button"
              className={`flex min-h-16 items-start justify-between gap-2 rounded-2xl border p-3 text-left text-sm leading-tight ${
                flavorId === variant.id ? 'border-primary bg-primary/10' : 'border-border bg-card'
              }`}
              onClick={() => onPick(variant.id)}
            >
              <span className="min-w-0 font-medium">{variant.name}</span>
              <StockCorner tone={tone} label={label} />
            </button>
          )
        })}
      </div>
      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button type="button" variant="outline" className="size-11" disabled={current === 0} onClick={() => onPage(current - 1)} aria-label="Sabores anteriores">
            <ChevronLeft />
          </Button>
          <span className="min-w-16 text-center text-sm text-muted-foreground">{current + 1} de {pageCount}</span>
          <Button type="button" variant="outline" className="size-11" disabled={current >= pageCount - 1} onClick={() => onPage(current + 1)} aria-label="Más sabores">
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function StockCorner({ tone, label }: { tone: StockTone | null; label: string | null }) {
  if (!label) return null
  return (
    <Badge
      variant={tone === 'agotado' ? 'destructive' : 'outline'}
      className={tone === 'bajo' ? 'shrink-0 border-amber-400/55 bg-amber-400/30 text-amber-100' : 'shrink-0'}
    >
      {label}
    </Badge>
  )
}

function productPickHint(product: Product) {
  const promo = promoLabel(
    (product.product_price_tiers ?? []).map((tier) => ({ quantity: tier.quantity, total: tier.total_price })),
    formatMoney,
  )
  if (promo) return `Promos: ${promo}`
  return product.requires_variant ? 'Elige el sabor y la cantidad.' : 'Elige la cantidad.'
}

function parseSaleResult(data: unknown): SaleResult {
  const row = data as SaleResult
  return {
    sale_id: row.sale_id,
    sale_number: asNumber(row.sale_number),
    created_at: row.created_at,
    subtotal: asNumber(row.subtotal),
    discount: asNumber(row.discount),
    total: asNumber(row.total),
    payment_method: row.payment_method,
    warnings: (row.warnings ?? []).map((warning) => ({
      ...warning,
      stock: asNumber(warning.stock),
      min_stock: asNumber(warning.min_stock),
    })),
  }
}

export function PosPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const productsQuery = useQuery({
    queryKey: ['products', 'active', profile?.role],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, category, price, low_stock_at, requires_variant, door_only, product_variants(id, name, price, active), product_price_tiers(quantity, total_price)')
        .eq('active', true)
        .order('category')
        .order('name')
      if (error) throw new Error(error.message)
      return ((data ?? []) as Product[]).map((product) => ({
        ...product,
        price: asNumber(product.price),
        low_stock_at: asNumber(product.low_stock_at),
        product_price_tiers: (product.product_price_tiers ?? [])
          .map((tier) => ({ quantity: asNumber(tier.quantity), total_price: asNumber(tier.total_price) }))
          .sort((a, b) => a.quantity - b.quantity),
        product_variants: (product.product_variants ?? [])
          .filter((variant) => variant.active)
          .map((variant) => ({
            ...variant,
            price: variant.price === null ? null : asNumber(variant.price),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'es')),
      }))
    },
  })

  const stockQuery = useQuery({
    queryKey: ['pos-stock'],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pos_ingredients')
      if (error) throw new Error(error.message)
      return ((data ?? []) as PosIngredient[]).map((row) => ({
        ...row,
        variant_id: row.variant_id ?? null,
        stock: asNumber(row.stock),
        min_stock: asNumber(row.min_stock),
        per_unit: asNumber(row.per_unit),
      }))
    },
  })

  const [category, setCategory] = useState('Todas')
  const [cart, setCart] = useState<CartLine[]>([])
  const [pickProduct, setPickProduct] = useState<Product | null>(null)
  const [flavorId, setFlavorId] = useState<string | null>(null)
  const [flavorPage, setFlavorPage] = useState(0)
  const [pickQty, setPickQty] = useState(1)
  const [discountMode, setDiscountMode] = useState<DiscountMode>('monto')
  const [discountValue, setDiscountValue] = useState('')
  const [payment, setPayment] = useState<PaymentMethod>('efectivo')
  const [note, setNote] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  const menu = useMemo(() => {
    return (productsQuery.data ?? []).filter((product) => {
      if (profile?.role === 'portero') return product.door_only
      if (profile?.role === 'cajero') return !product.door_only
      return true
    })
  }, [productsQuery.data, profile?.role])

  const categories = useMemo(() => {
    const names = new Set(menu.map((product) => product.category))
    return ['Todas', ...Array.from(names).sort((a, b) => a.localeCompare(b, 'es'))]
  }, [menu])

  const visible = menu.filter((product) => category === 'Todas' || product.category === category)
  const priced = useMemo(() => {
    const rules = new Map((productsQuery.data ?? []).map((product) => [
      product.id,
      {
        basePrice: product.price,
        tiers: (product.product_price_tiers ?? []).map((tier) => ({ quantity: tier.quantity, total: tier.total_price })),
      },
    ]))
    return priceLines(cart, rules)
  }, [cart, productsQuery.data])
  const promos = useMemo(() => {
    return (productsQuery.data ?? []).flatMap((product) => {
      const tiers = product.product_price_tiers ?? []
      if (tiers.length === 0) return []
      const units = cart.filter((line) => line.productId === product.id).reduce((sum, line) => sum + line.quantity, 0)
      if (!Number.isInteger(units) || units < 2) return []
      const bundle = bundleTotal(product.price, units, tiers.map((tier) => ({ quantity: tier.quantity, total: tier.total_price })))
      const list = roundMoney(product.price * units)
      if (bundle === list) return []
      return [`${units} × ${product.name} por ${formatMoney(bundle)}`]
    })
  }, [cart, productsQuery.data])
  const subtotal = priced.subtotal
  const rawDiscount = Number(discountValue.replace(',', '.')) || 0
  const discount = roundMoney(
    discountMode === 'porcentaje'
      ? Math.min(subtotal, subtotal * rawDiscount / 100)
      : Math.min(subtotal, Math.max(0, rawDiscount)),
  )
  const total = roundMoney(subtotal - discount)

  function commitCart(next: CartLine[]) {
    const message = shortageMessage(stockQuery.data ?? [], next)
    if (message) {
      toast.error(message)
      return false
    }
    setCart(next)
    return true
  }

  function addLine(line: Omit<CartLine, 'key' | 'quantity'> & { quantity?: number }) {
    const key = `${line.productId}:${line.variantId ?? ''}`
    const quantity = line.quantity ?? 1
    const existing = cart.find((item) => item.key === key)
    const next = existing
      ? cart.map((item) => item.key === key ? { ...item, quantity: item.quantity + quantity } : item)
      : [...cart, { ...line, key, quantity }]
    commitCart(next)
  }

  function setQuantity(key: string, quantity: number) {
    const next = quantity <= 0
      ? cart.filter((line) => line.key !== key)
      : cart.map((line) => line.key === key ? { ...line, quantity } : line)
    commitCart(next)
  }

  function openProduct(product: Product) {
    if (product.requires_variant && product.product_variants.length === 0) {
      toast.error(`${product.name} no tiene sabores activos`)
      return
    }
    setPickProduct(product)
    setFlavorId(product.requires_variant ? product.product_variants[0]?.id ?? null : null)
    setFlavorPage(0)
    setPickQty(1)
  }

  const sale = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_sale', {
        p_items: cart.map((line) => ({
          product_id: line.productId,
          variant_id: line.variantId,
          quantity: line.quantity,
        })),
        p_payment_method: payment,
        p_discount: discount,
        p_note: note.trim() || null,
      })
      if (error) throw new Error(error.message)
      return parseSaleResult(data)
    },
    onSuccess: (result) => {
      setReceipt({
        saleNumber: result.sale_number,
        createdAt: result.created_at,
        lines: priced.lines,
        subtotal: result.subtotal,
        discount: result.discount,
        total: result.total,
        payment: result.payment_method,
        note: note.trim(),
        warnings: result.warnings,
      })
      setCart([])
      setDiscountValue('')
      setNote('')
      setCartOpen(false)
      if (result.warnings.some((warning) => warning.level === 'agotado')) {
        toast.warning('Venta registrada. Hay insumos agotados.')
      } else if (result.warnings.some((warning) => warning.level === 'bajo')) {
        toast.success(`Venta #${result.sale_number} registrada. Quedó stock bajo.`)
      } else {
        toast.success(`Venta #${result.sale_number} registrada`)
      }
      void queryClient.invalidateQueries({ queryKey: ['sales'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['kpis'] })
      void queryClient.invalidateQueries({ queryKey: ['pos-stock'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const cartPanel = (
    <div className="grid gap-4">
      <div>
        <h2 className="font-heading text-2xl">Cuenta</h2>
        <p className="text-sm text-muted-foreground">{cart.reduce((sum, line) => sum + line.quantity, 0)} ítems</p>
      </div>
      <div className="grid max-h-72 gap-2 overflow-y-auto">
        {cart.length === 0 ? <p className="text-sm text-muted-foreground">Toca un producto para agregarlo.</p> : null}
        {priced.lines.map((line) => (
          <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-muted/60 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{line.name}</p>
              <p className="text-xs text-muted-foreground">
                {line.variantName ? `${line.variantName} · ` : ''}
                {formatMoney(line.charge)}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => setQuantity(line.key, line.quantity - 1)} aria-label="Quitar uno">
                <Minus />
              </Button>
              <span className="w-8 text-center text-sm font-semibold">{line.quantity}</span>
              <Button variant="outline" size="icon" onClick={() => setQuantity(line.key, line.quantity + 1)} aria-label="Agregar uno">
                <Plus />
              </Button>
            </div>
          </div>
        ))}
      </div>
      {promos.map((note) => <p key={note} className="text-sm text-primary">{note}</p>)}
      <div className="grid gap-2">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={discountMode === 'monto' ? 'default' : 'outline'}
            className="h-10 flex-1"
            onClick={() => setDiscountMode('monto')}
          >
            Descuento $
          </Button>
          <Button
            type="button"
            variant={discountMode === 'porcentaje' ? 'default' : 'outline'}
            className="h-10 flex-1"
            onClick={() => setDiscountMode('porcentaje')}
          >
            Descuento %
          </Button>
        </div>
        <Input
          inputMode="decimal"
          placeholder={discountMode === 'monto' ? '0.00' : '0'}
          value={discountValue}
          onChange={(event) => setDiscountValue(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {payments.map(({ method, icon: Icon }) => (
          <Button
            key={method}
            type="button"
            variant={payment === method ? 'default' : 'outline'}
            className="h-auto min-h-14 w-full min-w-0 flex-col gap-1 whitespace-normal px-1 py-2 text-xs leading-tight"
            onClick={() => setPayment(method)}
          >
            <Icon />
            {paymentLabels[method]}
          </Button>
        ))}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="sale-note">Nota (opcional)</Label>
        <Textarea
          id="sale-note"
          maxLength={300}
          placeholder="Algo para recordar de esta venta"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <dl className="grid gap-1 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(subtotal)}</dd></div>
        <div className="flex justify-between text-muted-foreground"><dt>Descuento</dt><dd>-{formatMoney(discount)}</dd></div>
        <div className="flex justify-between font-heading text-2xl"><dt>Total</dt><dd>{formatMoney(total)}</dd></div>
      </dl>
      <Button
        className="h-14 text-base"
        disabled={cart.length === 0 || sale.isPending || stockQuery.isLoading}
        onClick={() => {
          const message = shortageMessage(stockQuery.data ?? [], cart)
          if (message) {
            toast.error(message)
            return
          }
          sale.mutate()
        }}
      >
        {sale.isPending ? 'Registrando…' : <><Receipt /> Registrar venta</>}
      </Button>
    </div>
  )

  return (
    <div className="pb-24 lg:pb-0">
      <div className="mb-4">
        <h1 className="font-heading text-3xl">Facturación</h1>
        <p className="text-sm text-muted-foreground">
          {profile?.role === 'portero'
            ? 'Entrada y barra libre. Elige la cantidad al tocar.'
            : 'Toca un producto y elige la cantidad. Si pide sabor, confírmalo.'}
        </p>
      </div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {categories.map((name) => (
          <Button
            key={name}
            variant={category === name ? 'default' : 'outline'}
            className="h-10 shrink-0"
            onClick={() => setCategory(name)}
          >
            {name}
          </Button>
        ))}
      </div>
      {productsQuery.isLoading ? <p className="text-sm text-muted-foreground">Cargando menú…</p> : null}
      {productsQuery.isError ? <p className="text-sm text-destructive">{errorMessage(productsQuery.error)}</p> : null}
      {stockQuery.isError ? <p className="mb-3 text-sm text-destructive">No se pudo cargar el stock. Igual se valida al registrar la venta.</p> : null}
      {!productsQuery.isLoading && visible.length === 0 ? (
        <EmptyState
          title="No hay productos"
          detail={profile?.role === 'admin'
            ? 'Carga el menú en Catálogo.'
            : 'Pide a un administrador que cargue el menú.'}
        />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visible.map((product) => {
            const inCart = cart.filter((line) => line.productId === product.id).reduce((sum, line) => sum + line.quantity, 0)
            const tone = product.requires_variant ? null : stockTone(stockQuery.data ?? [], product.id, null, product.low_stock_at)
            const label = stockLabel(tone)
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => openProduct(product)}
                className="flex min-h-28 flex-col items-start justify-between rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/60"
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-xs tracking-wide text-muted-foreground uppercase">{product.category}</span>
                    <span className="font-heading mt-1 block text-xl">{product.name}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <StockCorner tone={tone} label={label} />
                    {inCart > 0 ? (
                      <span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                        {inCart}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="text-sm font-medium text-primary">{formatMoney(product.price)}</span>
              </button>
            )
          })}
        </div>
        <aside className="sticky top-20 hidden rounded-3xl border border-border bg-card p-4 lg:block">
          {cartPanel}
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 p-3 backdrop-blur lg:hidden">
        <Button className="h-14 w-full text-base" onClick={() => setCartOpen(true)}>
          Ver cuenta · {formatMoney(total)}
        </Button>
      </div>

      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="max-h-[88svh] overflow-y-auto rounded-t-3xl">
          <SheetHeader>
            <SheetTitle className="sr-only">Cuenta</SheetTitle>
            <SheetDescription className="sr-only">Productos de la venta actual</SheetDescription>
          </SheetHeader>
          {cartPanel}
        </SheetContent>
      </Sheet>

      <Dialog open={pickProduct !== null} onOpenChange={(open) => { if (!open) setPickProduct(null) }}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">{pickProduct?.name}</DialogTitle>
            <DialogDescription>
              {pickProduct ? productPickHint(pickProduct) : ''}
            </DialogDescription>
          </DialogHeader>
          {pickProduct?.requires_variant ? (
            <FlavorPages
              flavors={pickProduct.product_variants}
              flavorId={flavorId}
              page={flavorPage}
              onPage={setFlavorPage}
              onPick={setFlavorId}
              toneOf={(id) => stockTone(stockQuery.data ?? [], pickProduct.id, id, pickProduct.low_stock_at)}
            />
          ) : null}
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="icon-lg" onClick={() => setPickQty((value) => Math.max(1, value - 1))} aria-label="Menos">
              <Minus />
            </Button>
            <span className="w-10 text-center text-2xl font-semibold">{pickQty}</span>
            <Button variant="outline" size="icon-lg" onClick={() => setPickQty((value) => value + 1)} aria-label="Más">
              <Plus />
            </Button>
          </div>
          <DialogFooter>
            <Button
              className="h-12 w-full"
              onClick={() => {
                if (!pickProduct) return
                const variant = pickProduct.requires_variant
                  ? pickProduct.product_variants.find((item) => item.id === flavorId)
                  : null
                if (pickProduct.requires_variant && !variant) return
                addLine({
                  productId: pickProduct.id,
                  variantId: variant?.id ?? null,
                  name: pickProduct.name,
                  variantName: variant?.name ?? null,
                  unitPrice: variant?.price ?? pickProduct.price,
                  quantity: pickQty,
                })
                setPickProduct(null)
              }}
            >
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={receipt !== null} onOpenChange={(open) => { if (!open) setReceipt(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Venta registrada</DialogTitle>
            <DialogDescription>Puedes imprimir el comprobante interno.</DialogDescription>
          </DialogHeader>
          {receipt ? (
            <div id="receipt" className="rounded-2xl bg-white p-4 text-black">
              <p className="text-center font-heading text-2xl">Coctiki</p>
              <p className="text-center text-xs tracking-[0.2em] uppercase">Cayambe</p>
              <p className="mt-3 text-sm">Venta #{String(receipt.saleNumber).padStart(4, '0')}</p>
              <p className="text-sm">{formatDateTime(receipt.createdAt)}</p>
              <p className="text-sm">Atiende: {profile?.full_name}</p>
              <div className="my-3 border-t border-dashed border-black/30" />
              {receipt.lines.map((line) => (
                <div key={line.key} className="flex justify-between gap-3 text-sm">
                  <span>{line.quantity} {line.name}{line.variantName ? ` ${line.variantName}` : ''}</span>
                  <span>{formatMoney(line.charge)}</span>
                </div>
              ))}
              <div className="my-3 border-t border-dashed border-black/30" />
              <div className="flex justify-between text-sm"><span>Subtotal</span><span>{formatMoney(receipt.subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span>Descuento</span><span>-{formatMoney(receipt.discount)}</span></div>
              <div className="mt-1 flex justify-between text-lg font-semibold"><span>Total</span><span>{formatMoney(receipt.total)}</span></div>
              <p className="mt-2 text-sm">{paymentLabels[receipt.payment]}</p>
              {receipt.note ? <p className="mt-2 text-sm">Nota: {receipt.note}</p> : null}
              <p className="mt-4 text-center text-xs">Gracias</p>
            </div>
          ) : null}
          {receipt && receipt.warnings.length > 0 ? (
            <ul className="grid gap-1 text-sm">
              {receipt.warnings.map((warning) => (
                <li key={warning.item_id} className={warning.level === 'bajo' ? 'text-amber-200' : 'text-destructive'}>
                  {warning.level === 'agotado' ? 'Agotado' : warning.level === 'negativo' ? 'Stock negativo' : 'Stock bajo'}: {warning.item_name} quedó en {formatStock(warning.stock, warning.unit)}
                </li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => window.print()}>
              <Printer />
              Imprimir
            </Button>
            <Button className="h-11" onClick={() => setReceipt(null)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
