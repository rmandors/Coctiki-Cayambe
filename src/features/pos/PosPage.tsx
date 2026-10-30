import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, CreditCard, Minus, Plus, Printer, Receipt, ArrowRightLeft } from 'lucide-react'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet.tsx'
import { asNumber, errorMessage, formatDateTime, formatMoney, formatStock, roundMoney } from '@/lib/format.ts'
import { paymentLabels } from '@/lib/labels.ts'
import { bundleTotal, priceLines, promoLabel } from '@/lib/pricing.ts'
import { supabase } from '@/lib/supabase.ts'
import type { CartLine, PaymentMethod, Product, SaleResult, StockWarning } from '@/lib/types.ts'

type DiscountMode = 'monto' | 'porcentaje'

type Receipt = {
  saleNumber: number
  createdAt: string
  lines: Array<CartLine & { charge: number }>
  subtotal: number
  discount: number
  total: number
  payment: PaymentMethod
  warnings: StockWarning[]
}

const payments: { method: PaymentMethod; icon: typeof Banknote }[] = [
  { method: 'efectivo', icon: Banknote },
  { method: 'transferencia', icon: ArrowRightLeft },
  { method: 'tarjeta', icon: CreditCard },
]

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
        .select('id, name, category, price, requires_variant, door_only, product_variants(id, name, price, active), product_price_tiers(quantity, total_price)')
        .eq('active', true)
        .order('category')
        .order('name')
      if (error) throw new Error(error.message)
      return ((data ?? []) as Product[]).map((product) => ({
        ...product,
        price: asNumber(product.price),
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

  const [category, setCategory] = useState('Todas')
  const [cart, setCart] = useState<CartLine[]>([])
  const [pickProduct, setPickProduct] = useState<Product | null>(null)
  const [flavorId, setFlavorId] = useState<string | null>(null)
  const [pickQty, setPickQty] = useState(1)
  const [discountMode, setDiscountMode] = useState<DiscountMode>('monto')
  const [discountValue, setDiscountValue] = useState('')
  const [payment, setPayment] = useState<PaymentMethod>('efectivo')
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

  function addLine(line: Omit<CartLine, 'key' | 'quantity'> & { quantity?: number }) {
    const key = `${line.productId}:${line.variantId ?? ''}`
    const quantity = line.quantity ?? 1
    setCart((current) => {
      const existing = current.find((item) => item.key === key)
      if (!existing) return [...current, { ...line, key, quantity }]
      return current.map((item) => item.key === key ? { ...item, quantity: item.quantity + quantity } : item)
    })
  }

  function setQuantity(key: string, quantity: number) {
    setCart((current) => quantity <= 0
      ? current.filter((line) => line.key !== key)
      : current.map((line) => line.key === key ? { ...line, quantity } : line))
  }

  function openProduct(product: Product) {
    if (product.requires_variant && product.product_variants.length === 0) {
      toast.error(`${product.name} no tiene sabores activos`)
      return
    }
    setPickProduct(product)
    setFlavorId(product.requires_variant ? product.product_variants[0]?.id ?? null : null)
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
        warnings: result.warnings,
      })
      setCart([])
      setDiscountValue('')
      setCartOpen(false)
      if (result.warnings.some((warning) => warning.level === 'negativo')) {
        toast.warning('Venta registrada. Hay insumos en negativo.')
      } else {
        toast.success(`Venta #${result.sale_number} registrada`)
      }
      void queryClient.invalidateQueries({ queryKey: ['sales'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['kpis'] })
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
      <dl className="grid gap-1 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(subtotal)}</dd></div>
        <div className="flex justify-between text-muted-foreground"><dt>Descuento</dt><dd>-{formatMoney(discount)}</dd></div>
        <div className="flex justify-between font-heading text-2xl"><dt>Total</dt><dd>{formatMoney(total)}</dd></div>
      </dl>
      <Button className="h-14 text-base" disabled={cart.length === 0 || sale.isPending} onClick={() => sale.mutate()}>
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
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => openProduct(product)}
                className="relative flex min-h-28 flex-col items-start justify-between rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/60"
              >
                {inCart > 0 ? (
                  <span className="absolute top-3 right-3 grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {inCart}
                  </span>
                ) : null}
                <span>
                  <span className="block text-xs tracking-wide text-muted-foreground uppercase">{product.category}</span>
                  <span className="font-heading mt-1 block text-xl">{product.name}</span>
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">{pickProduct?.name}</DialogTitle>
            <DialogDescription>
              {pickProduct
                ? [
                    pickProduct.requires_variant ? 'Puedes mezclar sabores.' : null,
                    promoLabel(
                      (pickProduct.product_price_tiers ?? []).map((tier) => ({ quantity: tier.quantity, total: tier.total_price })),
                      formatMoney,
                    ) || (pickProduct.requires_variant ? 'Elige el sabor y la cantidad.' : 'Elige la cantidad.'),
                  ].filter(Boolean).join(' ')
                : ''}
            </DialogDescription>
          </DialogHeader>
          {pickProduct?.requires_variant ? (
            <div className="grid grid-cols-2 gap-2">
              {pickProduct.product_variants.map((variant) => (
                <Button
                  key={variant.id}
                  type="button"
                  variant={flavorId === variant.id ? 'default' : 'outline'}
                  className="h-12"
                  onClick={() => setFlavorId(variant.id)}
                >
                  {variant.name}
                </Button>
              ))}
            </div>
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
              <p className="mt-4 text-center text-xs">Gracias</p>
            </div>
          ) : null}
          {receipt && receipt.warnings.length > 0 ? (
            <ul className="grid gap-1 text-sm">
              {receipt.warnings.map((warning) => (
                <li key={warning.item_id} className={warning.level === 'negativo' ? 'text-destructive' : 'text-amber-200'}>
                  {warning.level === 'negativo' ? 'Stock negativo' : 'Stock bajo'}: {warning.item_name} quedó en {formatStock(warning.stock, warning.unit)}
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
