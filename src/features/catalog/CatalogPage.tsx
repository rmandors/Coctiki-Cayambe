import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, PageHeader } from '@/components/feedback.tsx'
import { Button } from '@/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx'
import { asNumber, errorMessage, formatMoney, formatPercent, formatQty } from '@/lib/format.ts'
import { unitOptions } from '@/lib/labels.ts'
import { supabase } from '@/lib/supabase.ts'
import type { InventoryItem, InventoryUnit, Product, ProductVariant, RecipeItem } from '@/lib/types.ts'

type DraftLine = {
  key: string
  inventoryItemId: string
  mode: 'cantidad' | 'rinde'
  amount: string
}

function numberOrNull(value: string) {
  if (value.trim() === '') return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function toDraft(recipe: RecipeItem): DraftLine {
  const yieldCount = 1 / recipe.quantity
  const wholeYield = Math.abs(yieldCount - Math.round(yieldCount)) < 0.001 && yieldCount >= 2
  return {
    key: recipe.id,
    inventoryItemId: recipe.inventory_item_id,
    mode: wholeYield ? 'rinde' : 'cantidad',
    amount: wholeYield ? String(Math.round(yieldCount)) : String(recipe.quantity),
  }
}

export function CatalogPage() {
  const queryClient = useQueryClient()
  const itemsQuery = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_items').select('*').order('name')
      if (error) throw new Error(error.message)
      return ((data ?? []) as InventoryItem[]).map((item) => ({
        ...item,
        stock: asNumber(item.stock),
        min_stock: asNumber(item.min_stock),
        unit_cost: asNumber(item.unit_cost),
      }))
    },
  })
  const productsQuery = useQuery({
    queryKey: ['products', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, category, price, active, requires_variant, door_only, created_at, product_variants(id, product_id, name, price, active)')
        .order('category')
        .order('name')
      if (error) throw new Error(error.message)
      return ((data ?? []) as Product[]).map((product) => ({
        ...product,
        price: asNumber(product.price),
        product_variants: (product.product_variants ?? []).map((variant) => ({
          ...variant,
          price: variant.price === null ? null : asNumber(variant.price),
        })),
      }))
    },
  })
  const recipesQuery = useQuery({
    queryKey: ['recipes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('recipe_items').select('*')
      if (error) throw new Error(error.message)
      return ((data ?? []) as RecipeItem[]).map((recipe) => ({ ...recipe, quantity: asNumber(recipe.quantity) }))
    },
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    void queryClient.invalidateQueries({ queryKey: ['products'] })
    void queryClient.invalidateQueries({ queryKey: ['recipes'] })
    void queryClient.invalidateQueries({ queryKey: ['catalog-margins'] })
  }

  return (
    <div>
      <PageHeader
        title="Catálogo"
        description="Insumos, productos y la conversión de cada receta. 1 galón rinde 6 jarras, así que cada jarra descuenta 0.1667 galón."
      />
      <Tabs defaultValue="productos">
        <TabsList className="h-11">
          <TabsTrigger value="productos" className="h-9 px-4">Productos</TabsTrigger>
          <TabsTrigger value="insumos" className="h-9 px-4">Insumos</TabsTrigger>
        </TabsList>
        <TabsContent value="productos" className="mt-4">
          <ProductsPanel
            products={productsQuery.data ?? []}
            items={itemsQuery.data ?? []}
            recipes={recipesQuery.data ?? []}
            onSaved={refresh}
          />
        </TabsContent>
        <TabsContent value="insumos" className="mt-4">
          <ItemsPanel items={itemsQuery.data ?? []} onSaved={refresh} />
        </TabsContent>
      </Tabs>
      {productsQuery.isError ? <p className="mt-3 text-sm text-destructive">{errorMessage(productsQuery.error)}</p> : null}
    </div>
  )
}

function ItemsPanel({ items, onSaved }: { items: InventoryItem[]; onSaved: () => void }) {
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [creating, setCreating] = useState(false)

  const save = useMutation({
    mutationFn: async (input: {
      id?: string
      name: string
      unit: InventoryUnit
      minStock: number
      unitCost: number
      initial: number
      active: boolean
    }) => {
      if (input.id) {
        const { error } = await supabase.from('inventory_items').update({
          name: input.name,
          min_stock: input.minStock,
          unit_cost: input.unitCost,
          active: input.active,
        }).eq('id', input.id)
        if (error) throw new Error(error.message)
        return
      }
      const { data, error } = await supabase.from('inventory_items').insert({
        name: input.name,
        unit: input.unit,
        stock: 0,
        min_stock: input.minStock,
        unit_cost: input.unitCost,
        active: true,
      }).select('id').single()
      if (error) throw new Error(error.message)
      if (input.initial > 0) {
        const adjustment = await supabase.rpc('adjust_inventory', {
          p_item_id: data.id,
          p_reason: 'compra',
          p_delta: input.initial,
          p_unit_cost: input.unitCost,
          p_note: 'Stock inicial',
        })
        if (adjustment.error) throw new Error(adjustment.error.message)
      }
    },
    onSuccess: () => {
      toast.success('Insumo guardado')
      setEditing(null)
      setCreating(false)
      onSaved()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button className="h-11" onClick={() => setCreating(true)}><Plus /> Nuevo insumo</Button>
      </div>
      <div className="grid gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setEditing(item)}
            className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-left"
          >
            <span>
              <span className="block font-medium">{item.name}</span>
              <span className="text-xs text-muted-foreground">
                {formatQty(item.stock)} {unitOptions.find((option) => option.value === item.unit)?.label} · {formatMoney(item.unit_cost)}
              </span>
            </span>
            <span className="text-sm text-muted-foreground">{item.active ? 'Activo' : 'Inactivo'}</span>
          </button>
        ))}
      </div>
      <ItemDialog
        key={editing?.id ?? (creating ? 'new' : 'idle')}
        open={creating || editing !== null}
        item={editing}
        pending={save.isPending}
        onClose={() => { setCreating(false); setEditing(null) }}
        onSave={(input) => save.mutate(input)}
      />
    </div>
  )
}

function ItemDialog({
  open,
  item,
  pending,
  onClose,
  onSave,
}: {
  open: boolean
  item: InventoryItem | null
  pending: boolean
  onClose: () => void
  onSave: (input: {
    id?: string
    name: string
    unit: InventoryUnit
    minStock: number
    unitCost: number
    initial: number
    active: boolean
  }) => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [unit, setUnit] = useState<InventoryUnit>(item?.unit ?? 'unidad')
  const [minStock, setMinStock] = useState(String(item?.min_stock ?? 0))
  const [unitCost, setUnitCost] = useState(String(item?.unit_cost ?? 0))
  const [initial, setInitial] = useState('0')
  const [active, setActive] = useState(item?.active ?? true)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? 'Editar insumo' : 'Nuevo insumo'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="item-name">Nombre</Label>
            <Input id="item-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Unidad</Label>
            <Select value={unit} disabled={Boolean(item)} onValueChange={(value) => setUnit(value as InventoryUnit)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {unitOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="item-min">Mínimo</Label>
              <Input id="item-min" inputMode="decimal" value={minStock} onChange={(event) => setMinStock(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="item-cost">Costo por unidad</Label>
              <Input id="item-cost" inputMode="decimal" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} />
            </div>
          </div>
          {item ? null : (
            <div className="grid gap-1.5">
              <Label htmlFor="item-initial">Stock inicial</Label>
              <Input id="item-initial" inputMode="decimal" value={initial} onChange={(event) => setInitial(event.target.value)} />
            </div>
          )}
          {item ? (
            <label className="flex items-center justify-between text-sm">
              Activo
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            disabled={pending || name.trim() === ''}
            onClick={() => {
              const min = numberOrNull(minStock)
              const cost = numberOrNull(unitCost)
              const opening = numberOrNull(initial)
              if (min === null || min < 0 || cost === null || cost < 0 || opening === null || opening < 0) {
                toast.error('Revisa mínimo, costo y stock')
                return
              }
              onSave({
                id: item?.id,
                name: name.trim(),
                unit,
                minStock: min,
                unitCost: cost,
                initial: opening,
                active,
              })
            }}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProductsPanel({
  products,
  items,
  recipes,
  onSaved,
}: {
  products: Product[]
  items: InventoryItem[]
  recipes: RecipeItem[]
  onSaved: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(products[0]?.id ?? null)
  const [creating, setCreating] = useState(false)
  const selected = products.find((product) => product.id === selectedId) ?? null

  const create = useMutation({
    mutationFn: async (input: { name: string; category: string; price: number; requiresVariant: boolean }) => {
      const { data, error } = await supabase.from('products').insert({
        name: input.name,
        category: input.category,
        price: input.price,
        requires_variant: input.requiresVariant,
      }).select('id').single()
      if (error) throw new Error(error.message)
      return data.id as string
    },
    onSuccess: (id) => {
      setCreating(false)
      setSelectedId(id)
      onSaved()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div>
        <Button className="mb-3 h-11 w-full" onClick={() => setCreating(true)}><Plus /> Nuevo producto</Button>
        <div className="grid gap-2">
          {products.map((product) => (
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
      </div>
      {selected ? (
        <ProductEditor key={selected.id} product={selected} items={items} recipes={recipes} onSaved={onSaved} />
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
    <section className="grid gap-3">
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
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-28" inputMode="numeric" placeholder="Cantidad" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        <Input className="max-w-32" inputMode="decimal" placeholder="Precio total" value={total} onChange={(event) => setTotal(event.target.value)} />
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
  onSave: (input: { name: string; category: string; price: number; requiresVariant: boolean }) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('')
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
              if (!name.trim() || !category.trim() || parsed === null || parsed < 0) {
                toast.error('Completa nombre, categoría y precio')
                return
              }
              onSave({ name: name.trim(), category: category.trim(), price: parsed, requiresVariant })
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
  items,
  recipes,
  onSaved,
}: {
  product: Product
  items: InventoryItem[]
  recipes: RecipeItem[]
  onSaved: () => void
}) {
  const [name, setName] = useState(product.name)
  const [category, setCategory] = useState(product.category)
  const [price, setPrice] = useState(String(product.price))
  const [requiresVariant, setRequiresVariant] = useState(product.requires_variant)
  const [doorOnly, setDoorOnly] = useState(product.door_only)
  const [active, setActive] = useState(product.active)
  const [scope, setScope] = useState('base')
  const [variantName, setVariantName] = useState('')
  const [variantPrice, setVariantPrice] = useState('')
  const recipeKey = `${product.id}:${scope}`
  const serverLines = useMemo(() => {
    const variantId = scope === 'base' ? null : scope
    return recipes
      .filter((recipe) => recipe.product_id === product.id && (recipe.variant_id ?? null) === variantId)
      .map(toDraft)
  }, [product.id, recipes, scope])
  const [draft, setDraft] = useState<{ key: string; lines: DraftLine[] } | null>(null)
  const lines = draft?.key === recipeKey ? draft.lines : serverLines

  function setLines(next: DraftLine[] | ((current: DraftLine[]) => DraftLine[])) {
    setDraft((current) => {
      const base = current?.key === recipeKey ? current.lines : serverLines
      return { key: recipeKey, lines: typeof next === 'function' ? next(base) : next }
    })
  }

  const saveProduct = useMutation({
    mutationFn: async () => {
      const parsed = numberOrNull(price)
      if (!name.trim() || !category.trim() || parsed === null || parsed < 0) {
        throw new Error('Completa nombre, categoría y precio')
      }
      const { error } = await supabase.from('products').update({
        name: name.trim(),
        category: category.trim(),
        price: parsed,
        requires_variant: requiresVariant,
        door_only: doorOnly,
        active,
      }).eq('id', product.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success('Producto actualizado')
      onSaved()
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
        return
      }
      const { error } = await supabase.from('product_variants').insert({
        product_id: product.id,
        name: input.name,
        price: input.price,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      setVariantName('')
      setVariantPrice('')
      onSaved()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const saveRecipe = useMutation({
    mutationFn: async () => {
      const payload = lines.flatMap((line) => {
        if (!line.inventoryItemId && line.amount.trim() === '') return []
        const amount = numberOrNull(line.amount)
        if (!line.inventoryItemId || amount === null || amount <= 0) {
          throw new Error('Cada línea de la receta necesita insumo y cantidad')
        }
        return [{
          inventory_item_id: line.inventoryItemId,
          quantity: line.mode === 'rinde' ? 1 / amount : amount,
        }]
      })
      const { error } = await supabase.rpc('replace_recipe', {
        p_product_id: product.id,
        p_variant_id: scope === 'base' ? null : scope,
        p_items: payload,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      setDraft(null)
      toast.success('Receta guardada')
      onSaved()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const preview = useMemo(() => {
    return lines.reduce((sum, line) => {
      const amount = numberOrNull(line.amount)
      const item = items.find((candidate) => candidate.id === line.inventoryItemId)
      if (!item || amount === null || amount <= 0) return sum
      const quantity = line.mode === 'rinde' ? 1 / amount : amount
      return sum + quantity * item.unit_cost
    }, 0)
  }, [lines, items])

  const sellPrice = numberOrNull(price) ?? 0
  const scopeVariant = product.product_variants.find((variant) => variant.id === scope)
  const effectivePrice = scopeVariant?.price ?? sellPrice
  const margin = effectivePrice === 0 ? 0 : ((effectivePrice - preview) / effectivePrice) * 100
  const selectedItem = (line: DraftLine) => items.find((item) => item.id === line.inventoryItemId)

  return (
    <div className="grid gap-5 rounded-3xl border border-border bg-card p-4">
      <div className="grid gap-3 md:grid-cols-2">
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
        <div className="flex items-end justify-between gap-4 pb-1">
          <label className="flex items-center gap-2 text-sm">Pide sabor <Switch checked={requiresVariant} onCheckedChange={setRequiresVariant} /></label>
          <label className="flex items-center gap-2 text-sm">Solo portería <Switch checked={doorOnly} onCheckedChange={setDoorOnly} /></label>
          <label className="flex items-center gap-2 text-sm">Activo <Switch checked={active} onCheckedChange={setActive} /></label>
        </div>
      </div>
      <Button className="h-11 w-fit" disabled={saveProduct.isPending} onClick={() => saveProduct.mutate()}>
        Guardar producto
      </Button>

      <PriceTiersEditor productId={product.id} />

      {requiresVariant ? (
        <section className="grid gap-3">
          <h2 className="font-heading text-xl">Sabores</h2>
          {product.product_variants.map((variant) => (
            <VariantRow
              key={`${variant.id}:${variant.name}:${variant.price ?? ''}:${variant.active}`}
              variant={variant}
              pending={saveVariant.isPending}
              onSave={(input) => saveVariant.mutate(input)}
            />
          ))}
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-48" placeholder="Nuevo sabor" value={variantName} onChange={(event) => setVariantName(event.target.value)} />
            <Input className="max-w-32" inputMode="decimal" placeholder="Precio opcional" value={variantPrice} onChange={(event) => setVariantPrice(event.target.value)} />
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
      ) : (
      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl">Receta</h2>
            <p className="text-sm text-muted-foreground">
              Si un sabor tiene receta propia, se usa esa. Si no, se usa la receta base.
            </p>
          </div>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="base">Receta base</SelectItem>
              {product.product_variants.filter((variant) => variant.active).map((variant) => (
                <SelectItem key={variant.id} value={variant.id}>{variant.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {lines.map((line, index) => {
          const item = selectedItem(line)
          const amount = numberOrNull(line.amount)
          const perSale = item && amount && amount > 0
            ? line.mode === 'rinde' ? 1 / amount : amount
            : null
          return (
            <div key={line.key} className="grid gap-2 rounded-2xl bg-muted/50 p-3 md:grid-cols-[minmax(0,1fr)_8rem_8rem_auto]">
              <Select
                value={line.inventoryItemId || undefined}
                onValueChange={(value) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, inventoryItemId: value } : entry))}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Insumo" /></SelectTrigger>
                <SelectContent>
                  {items.filter((candidate) => candidate.active).map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={line.mode}
                onValueChange={(value) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, mode: value as DraftLine['mode'] } : entry))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cantidad">Cantidad</SelectItem>
                  <SelectItem value="rinde">1 unidad rinde</SelectItem>
                </SelectContent>
              </Select>
              <Input
                inputMode="decimal"
                value={line.amount}
                onChange={(event) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, amount: event.target.value } : entry))}
              />
              <Button variant="ghost" onClick={() => setLines((current) => current.filter((_, entryIndex) => entryIndex !== index))}>Quitar</Button>
              {perSale !== null && item ? (
                <p className="text-xs text-muted-foreground md:col-span-4">
                  Cada venta descuenta {formatQty(perSale)} {unitOptions.find((option) => option.value === item.unit)?.label.toLowerCase()}.
                </p>
              ) : null}
            </div>
          )
        })}
        <Button
          variant="outline"
          className="h-11 w-fit"
          onClick={() => setLines((current) => [...current, { key: crypto.randomUUID(), inventoryItemId: '', mode: 'rinde', amount: '' }])}
        >
          Agregar insumo
        </Button>
        <p className="text-sm">
          Costo de esta receta: <strong>{formatMoney(preview)}</strong>
          {' · '}
          margen {formatPercent(margin)}
        </p>
        <Button className="h-11 w-fit" disabled={saveRecipe.isPending} onClick={() => saveRecipe.mutate()}>
          Guardar receta
        </Button>
      </section>
      )}
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
    <div className="flex flex-wrap items-center gap-2">
      <Input className="max-w-48" value={name} onChange={(event) => setName(event.target.value)} />
      <Input className="max-w-32" inputMode="decimal" placeholder="Precio del producto" value={price} onChange={(event) => setPrice(event.target.value)} />
      <Switch checked={variant.active} onCheckedChange={(checked) => onSave({ id: variant.id, name: name.trim() || variant.name, price: variant.price, active: checked })} />
      <Button
        variant="outline"
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
