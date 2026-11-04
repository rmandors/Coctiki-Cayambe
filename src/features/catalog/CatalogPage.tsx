import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, PageHeader } from '@/components/feedback.tsx'
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
import { Switch } from '@/components/ui/switch.tsx'
import { asNumber, errorMessage, formatMoney } from '@/lib/format.ts'
import { supabase } from '@/lib/supabase.ts'
import type { Product, ProductVariant } from '@/lib/types.ts'
import { isJarra, linkFinishedProduct, linkFlavor, syncProductStock } from '@/features/catalog/stockLink.ts'

const pageSize = 8

function numberOrNull(value: string) {
  if (value.trim() === '') return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  if (pageCount <= 1) return null
  return (
    <div className="mt-3 flex items-center justify-center gap-3">
      <Button type="button" variant="outline" className="size-10" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Página anterior">
        <ChevronLeft />
      </Button>
      <span className="min-w-16 text-center text-sm text-muted-foreground">{page + 1} de {pageCount}</span>
      <Button type="button" variant="outline" className="size-10" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)} aria-label="Página siguiente">
        <ChevronRight />
      </Button>
    </div>
  )
}

export function CatalogPage() {
  const queryClient = useQueryClient()
  const productsQuery = useQuery({
    queryKey: ['products', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, category, price, low_stock_at, active, requires_variant, door_only, created_at, product_variants(id, product_id, name, price, active)')
        .order('category')
        .order('name')
      if (error) throw new Error(error.message)
      return ((data ?? []) as Product[]).map((product) => ({
        ...product,
        price: asNumber(product.price),
        low_stock_at: asNumber(product.low_stock_at),
        product_variants: (product.product_variants ?? []).map((variant) => ({
          ...variant,
          price: variant.price === null ? null : asNumber(variant.price),
        })),
      }))
    },
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    void queryClient.invalidateQueries({ queryKey: ['products'] })
    void queryClient.invalidateQueries({ queryKey: ['recipes'] })
    void queryClient.invalidateQueries({ queryKey: ['catalog-margins'] })
    void queryClient.invalidateQueries({ queryKey: ['pos-stock'] })
  }

  return (
    <div>
      <PageHeader
        title="Catálogo"
        description="Lo que se vende. El stock se cuenta en Inventario. Una jarra descuenta un sexto del galón de su sabor."
      />
      <div className="mt-4">
        <ProductsPanel products={productsQuery.data ?? []} onSaved={refresh} />
      </div>
      {productsQuery.isError ? <p className="mt-3 text-sm text-destructive">{errorMessage(productsQuery.error)}</p> : null}
    </div>
  )
}

function ProductsPanel({
  products,
  onSaved,
}: {
  products: Product[]
  onSaved: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(products[0]?.id ?? null)
  const [creating, setCreating] = useState(false)
  const signature = products.map((product) => product.id).join('\0')
  const [page, setPage] = useState(0)
  const [seen, setSeen] = useState(`${selectedId ?? ''}\0${signature}`)
  const mark = `${selectedId ?? ''}\0${signature}`
  if (seen !== mark) {
    setSeen(mark)
    const index = products.findIndex((product) => product.id === selectedId)
    if (index >= 0) setPage(Math.floor(index / pageSize))
  }
  const pageCount = Math.max(1, Math.ceil(products.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  const visible = products.slice(current * pageSize, current * pageSize + pageSize)
  const selected = products.find((product) => product.id === selectedId) ?? null

  const create = useMutation({
    mutationFn: async (input: { name: string; category: string; price: number; lowStockAt: number; requiresVariant: boolean }) => {
      const { data, error } = await supabase.from('products').insert({
        name: input.name,
        category: input.category,
        price: input.price,
        low_stock_at: input.lowStockAt,
        requires_variant: input.requiresVariant,
      }).select('id').single()
      if (error) throw new Error(error.message)
      const id = data.id as string
      if (!input.requiresVariant) await linkFinishedProduct(id, input.name)
      return id
    },
    onSuccess: (id) => {
      setCreating(false)
      setSelectedId(id)
      onSaved()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div>
        <Button className="mb-3 h-11 w-full" onClick={() => setCreating(true)}><Plus /> Nuevo producto</Button>
        <div className="grid gap-2">
          {visible.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => setSelectedId(product.id)}
              className={product.id === selectedId
                ? 'rounded-xl bg-primary px-3 py-3 text-left text-primary-foreground'
                : 'rounded-xl border border-border bg-card px-3 py-3 text-left'}
            >
              <span className="block font-medium">{product.name}</span>
              <span className="text-xs opacity-80">{product.category} · {formatMoney(product.price)}</span>
            </button>
          ))}
        </div>
        <Pager page={current} pageCount={pageCount} onPage={setPage} />
      </div>
      {selected ? (
        <ProductEditor
          key={selected.id}
          product={selected}
          onSaved={onSaved}
          onDeleted={() => {
            const rest = products.filter((item) => item.id !== selected.id)
            setSelectedId(rest[0]?.id ?? null)
            onSaved()
          }}
        />
      ) : (
        <EmptyState title="Sin productos" detail="Crea el primero para armar el menú." />
      )}
      <ProductCreateDialog
        key={creating ? 'open' : 'closed'}
        open={creating}
        pending={create.isPending}
        categories={products.map((product) => product.category)}
        onClose={() => setCreating(false)}
        onSave={(input) => create.mutate(input)}
      />
    </div>
  )
}

function PriceTiersEditor({ productId }: { productId: string }) {
  const queryClient = useQueryClient()
  const [quantity, setQuantity] = useState('')
  const [total, setTotal] = useState('')
  const tiersQuery = useQuery({
    queryKey: ['price-tiers', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_price_tiers')
        .select('id, quantity, total_price')
        .eq('product_id', productId)
        .order('quantity')
      if (error) throw new Error(error.message)
      return (data ?? []).map((tier) => ({
        id: tier.id as string,
        quantity: asNumber(tier.quantity),
        total_price: asNumber(tier.total_price),
      }))
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      const pack = Number(quantity)
      const price = numberOrNull(total)
      if (!Number.isInteger(pack) || pack < 2 || price === null || price < 0) {
        throw new Error('La cantidad es un entero desde 2 y el precio no puede ser negativo')
      }
      const { error } = await supabase.from('product_price_tiers').upsert({
        product_id: productId,
        quantity: pack,
        total_price: price,
      }, { onConflict: 'product_id,quantity' })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      setQuantity('')
      setTotal('')
      void queryClient.invalidateQueries({ queryKey: ['price-tiers', productId] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('product_price_tiers').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['price-tiers', productId] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <section className="grid gap-2">
      <div>
        <h2 className="font-heading text-xl">Precio por cantidad</h2>
        <p className="text-sm text-muted-foreground">El precio de una unidad es el del producto. Desde 2, el total puede ser otro aunque se mezclen sabores.</p>
      </div>
      {(tiersQuery.data ?? []).map((tier) => (
        <div key={tier.id} className="flex items-center justify-between gap-3 text-sm">
          <span>{tier.quantity} por {formatMoney(tier.total_price)}</span>
          <Button variant="outline" className="h-9" onClick={() => remove.mutate(tier.id)}>Quitar</Button>
        </div>
      ))}
      <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,9rem)_auto] items-center gap-2">
        <Input inputMode="numeric" placeholder="Cantidad" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        <Input inputMode="decimal" placeholder="Precio total" value={total} onChange={(event) => setTotal(event.target.value)} />
        <Button variant="outline" className="h-11" disabled={save.isPending} onClick={() => save.mutate()}>Agregar</Button>
      </div>
    </section>
  )
}

function ProductCreateDialog({
  open,
  pending,
  categories,
  onClose,
  onSave,
}: {
  open: boolean
  pending: boolean
  categories: string[]
  onClose: () => void
  onSave: (input: { name: string; category: string; price: number; lowStockAt: number; requiresVariant: boolean }) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('')
  const [lowStockAt, setLowStockAt] = useState('3')
  const [requiresVariant, setRequiresVariant] = useState(false)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuevo producto</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="new-product">Nombre</Label>
            <Input id="new-product" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-category">Categoría</Label>
            <Input id="new-category" list="categories" value={category} onChange={(event) => setCategory(event.target.value)} />
            <datalist id="categories">
              {[...new Set(categories)].map((value) => <option key={value} value={value} />)}
            </datalist>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-price">Precio</Label>
            <Input id="new-price" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-low">Stock bajo desde</Label>
            <Input id="new-low" inputMode="decimal" value={lowStockAt} onChange={(event) => setLowStockAt(event.target.value)} />
          </div>
          <label className="flex items-center justify-between text-sm">
            Pide sabor al vender
            <Switch checked={requiresVariant} onCheckedChange={setRequiresVariant} />
          </label>
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => {
              const parsed = numberOrNull(price)
              const low = numberOrNull(lowStockAt)
              if (!name.trim() || !category.trim() || parsed === null || parsed < 0 || low === null || low < 0) {
                toast.error('Completa nombre, categoría, precio y stock bajo')
                return
              }
              onSave({ name: name.trim(), category: category.trim(), price: parsed, lowStockAt: low, requiresVariant })
            }}
          >
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProductEditor({
  product,
  onSaved,
  onDeleted,
}: {
  product: Product
  onSaved: () => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(product.name)
  const [category, setCategory] = useState(product.category)
  const [price, setPrice] = useState(String(product.price))
  const [lowStockAt, setLowStockAt] = useState(String(product.low_stock_at))
  const [requiresVariant, setRequiresVariant] = useState(product.requires_variant)
  const [doorOnly, setDoorOnly] = useState(product.door_only)
  const [active, setActive] = useState(product.active)
  const [variantName, setVariantName] = useState('')
  const [variantPrice, setVariantPrice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const saveProduct = useMutation({
    mutationFn: async () => {
      const parsed = numberOrNull(price)
      const low = numberOrNull(lowStockAt)
      if (!name.trim() || !category.trim() || parsed === null || parsed < 0 || low === null || low < 0) {
        throw new Error('Completa nombre, categoría, precio y stock bajo')
      }
      const { error } = await supabase.from('products').update({
        name: name.trim(),
        category: category.trim(),
        price: parsed,
        low_stock_at: low,
        requires_variant: requiresVariant,
        door_only: doorOnly,
        active,
      }).eq('id', product.id)
      if (error) throw new Error(error.message)
      await syncProductStock({
        productId: product.id,
        name: name.trim(),
        category: category.trim(),
        doorOnly,
        requiresVariant,
        variants: product.product_variants,
      })
    },
    onSuccess: () => {
      toast.success('Producto actualizado')
      onSaved()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const deleteProduct = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('products').delete().eq('id', product.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success('Producto eliminado')
      setConfirmDelete(false)
      onDeleted()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const saveVariant = useMutation({
    mutationFn: async (input: { id?: string; name: string; price: number | null; active?: boolean }) => {
      if (input.id) {
        const { error } = await supabase.from('product_variants').update({
          name: input.name,
          price: input.price,
          ...(input.active === undefined ? {} : { active: input.active }),
        }).eq('id', input.id)
        if (error) throw new Error(error.message)
        if (input.active !== false) {
          await linkFlavor(product.id, product.name, product.category, input.id, input.name)
        }
        return
      }
      const { data, error } = await supabase.from('product_variants').insert({
        product_id: product.id,
        name: input.name,
        price: input.price,
      }).select('id').single()
      if (error) throw new Error(error.message)
      await linkFlavor(product.id, product.name, product.category, data.id as string, input.name)
    },
    onSuccess: () => {
      setVariantName('')
      setVariantPrice('')
      onSaved()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <div className="flex flex-col gap-4 self-start rounded-3xl border border-border bg-card p-4">
      <div className="grid items-end gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="product-name">Nombre</Label>
          <Input id="product-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="product-category">Categoría</Label>
          <Input id="product-category" value={category} onChange={(event) => setCategory(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="product-price">Precio</Label>
          <Input id="product-price" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="product-low">Stock bajo desde</Label>
          <Input id="product-low" inputMode="decimal" value={lowStockAt} onChange={(event) => setLowStockAt(event.target.value)} />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border px-3 text-sm">
          Pide sabor
          <Switch checked={requiresVariant} onCheckedChange={setRequiresVariant} />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border px-3 text-sm">
          Solo portería
          <Switch checked={doorOnly} onCheckedChange={setDoorOnly} />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border px-3 text-sm">
          Activo
          <Switch checked={active} onCheckedChange={setActive} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="h-11" disabled={saveProduct.isPending} onClick={() => saveProduct.mutate()}>
          Guardar producto
        </Button>
        <Button variant="destructive" className="h-11" onClick={() => setConfirmDelete(true)}>
          <Trash2 /> Eliminar producto
        </Button>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar producto</DialogTitle>
            <DialogDescription>
              {product.name} saldrá del menú. Las ventas ya registradas se conservan. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={deleteProduct.isPending}
              onClick={() => deleteProduct.mutate()}
            >
              {deleteProduct.isPending ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PriceTiersEditor productId={product.id} />

      {requiresVariant ? (
        <section className="grid gap-2">
          <h2 className="font-heading text-xl">Sabores</h2>
          {product.product_variants.map((variant) => (
            <VariantRow
              key={`${variant.id}:${variant.name}:${variant.price ?? ''}:${variant.active}`}
              variant={variant}
              pending={saveVariant.isPending}
              onSave={(input) => saveVariant.mutate(input)}
            />
          ))}
          <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <Input placeholder="Nuevo sabor" value={variantName} onChange={(event) => setVariantName(event.target.value)} />
            <Input inputMode="decimal" placeholder="Precio opcional" value={variantPrice} onChange={(event) => setVariantPrice(event.target.value)} />
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                const parsed = variantPrice.trim() === '' ? null : numberOrNull(variantPrice)
                if (!variantName.trim() || (variantPrice.trim() !== '' && (parsed === null || parsed < 0))) {
                  toast.error('Revisa el sabor')
                  return
                }
                saveVariant.mutate({ name: variantName.trim(), price: parsed })
              }}
            >
              Agregar sabor
            </Button>
          </div>
        </section>
      ) : null}

      {doorOnly ? (
        <p className="text-sm text-muted-foreground">Este producto se cobra y no descuenta inventario.</p>
      ) : isJarra(category) ? (
        <p className="text-sm text-muted-foreground">Cada sabor descuenta un sexto de su galón. El galón se cuenta en Inventario.</p>
      ) : null}
    </div>
  )
}

function VariantRow({
  variant,
  pending,
  onSave,
}: {
  variant: ProductVariant
  pending: boolean
  onSave: (input: { id: string; name: string; price: number | null; active: boolean }) => void
}) {
  const [name, setName] = useState(variant.name)
  const [price, setPrice] = useState(variant.price === null ? '' : String(variant.price))

  return (
    <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto_auto]">
      <Input value={name} onChange={(event) => setName(event.target.value)} />
      <Input inputMode="decimal" placeholder="Precio del producto" value={price} onChange={(event) => setPrice(event.target.value)} />
      <Switch checked={variant.active} onCheckedChange={(checked) => onSave({ id: variant.id, name: name.trim() || variant.name, price: variant.price, active: checked })} />
      <Button
        variant="outline"
        className="h-11"
        disabled={pending}
        onClick={() => {
          const parsed = price.trim() === '' ? null : numberOrNull(price)
          if (!name.trim() || (price.trim() !== '' && (parsed === null || parsed < 0))) {
            toast.error('Precio de sabor inválido')
            return
          }
          onSave({ id: variant.id, name: name.trim(), price: parsed, active: variant.active })
        }}
      >
        Guardar sabor
      </Button>
    </div>
  )
}
