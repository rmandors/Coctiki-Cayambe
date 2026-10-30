import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageHeader } from '@/components/feedback.tsx'
import { Badge } from '@/components/ui/badge.tsx'
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
  asNumber,
  errorMessage,
  formatDateTime,
  formatMoney,
  formatQty,
  formatStock,
} from '@/lib/format.ts'
import { movementLabels, unitOptions } from '@/lib/labels.ts'
import { supabase } from '@/lib/supabase.ts'
import type { InventoryItem, InventoryMovement, InventoryUnit, MovementReason } from '@/lib/types.ts'

type Draft = {
  item: InventoryItem
  mode: 'ajuste' | 'compra'
}

function tone(item: InventoryItem) {
  if (item.stock <= 0) return 'out'
  if (item.stock <= item.min_stock) return 'low'
  return 'ok'
}

function barWidth(item: InventoryItem) {
  const cap = Math.max(item.min_stock * 4, 1)
  return Math.max(0, Math.min(100, (Math.max(item.stock, 0) / cap) * 100))
}

function mapItem(row: InventoryItem): InventoryItem {
  return {
    ...row,
    stock: asNumber(row.stock),
    min_stock: asNumber(row.min_stock),
    unit_cost: asNumber(row.unit_cost),
  }
}

export function InventoryPage() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [amount, setAmount] = useState('')
  const [cost, setCost] = useState('')
  const [note, setNote] = useState('')

  const itemsQuery = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_items').select('*').order('name')
      if (error) throw new Error(error.message)
      return ((data ?? []) as InventoryItem[]).map(mapItem)
    },
  })

  const movementsQuery = useQuery({
    queryKey: ['movements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_movements')
        .select('id, change, reason, note, created_at, inventory_items(name, unit), profiles(full_name)')
        .order('created_at', { ascending: false })
        .limit(40)
      if (error) throw new Error(error.message)
      return ((data ?? []) as unknown as InventoryMovement[]).map((row) => ({
        ...row,
        change: asNumber(row.change),
        inventory_items: Array.isArray(row.inventory_items) ? row.inventory_items[0] ?? null : row.inventory_items,
        profiles: Array.isArray(row.profiles) ? row.profiles[0] ?? null : row.profiles,
      }))
    },
  })

  const adjust = useMutation({
    mutationFn: async () => {
      if (!draft) return
      const value = Number(amount.replace(',', '.'))
      if (!Number.isFinite(value)) throw new Error('Cantidad inválida')
      const unitCost = cost.trim() === '' ? null : Number(cost.replace(',', '.'))
      if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
        throw new Error('Costo inválido')
      }
      const { error } = await supabase.rpc('adjust_inventory', {
        p_item_id: draft.item.id,
        p_reason: draft.mode satisfies MovementReason,
        p_new_stock: draft.mode === 'ajuste' ? value : null,
        p_delta: draft.mode === 'compra' ? value : null,
        p_note: note.trim() || null,
        p_unit_cost: draft.mode === 'compra' ? unitCost : null,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success(draft?.mode === 'compra' ? 'Compra registrada' : 'Stock actualizado')
      setDraft(null)
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['movements'] })
      void queryClient.invalidateQueries({ queryKey: ['kpis'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const items = itemsQuery.data ?? []
  const low = items.filter((item) => item.active && (item.stock <= item.min_stock || item.stock < 0))

  function open(item: InventoryItem, mode: Draft['mode']) {
    setDraft({ item, mode })
    setAmount(mode === 'ajuste' ? String(item.stock) : '')
    setCost(mode === 'compra' ? String(item.unit_cost) : '')
    setNote('')
  }

  return (
    <div>
      <PageHeader
        title="Inventario"
        description="El stock baja solo al registrar una venta. Aquí puedes contar o registrar una compra."
      />
      {low.length > 0 ? (
        <div className="mb-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm">
          {low.length} insumo{low.length === 1 ? '' : 's'} en o bajo el mínimo.
        </div>
      ) : null}
      {itemsQuery.isError ? <p className="mb-3 text-sm text-destructive">{errorMessage(itemsQuery.error)}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const level = tone(item)
          return (
            <article key={item.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-heading text-xl">{item.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {unitOptions.find((option) => option.value === item.unit)?.label} · costo {formatMoney(item.unit_cost)}
                  </p>
                </div>
                {!item.active ? <Badge variant="outline">Inactivo</Badge> : null}
                {level === 'out' ? <Badge variant="destructive">Agotado</Badge> : null}
                {level === 'low' ? <Badge variant="secondary">Bajo</Badge> : null}
              </div>
              <p className="mt-4 font-heading text-3xl">{formatQty(item.stock)}</p>
              <p className="text-xs text-muted-foreground">Mínimo {formatStock(item.min_stock, item.unit as InventoryUnit)}</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={level === 'out' ? 'h-full bg-destructive' : level === 'low' ? 'h-full bg-amber-400' : 'h-full bg-emerald-500'}
                  style={{ width: `${barWidth(item)}%` }}
                />
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" className="h-10 flex-1" onClick={() => open(item, 'ajuste')}>Contar</Button>
                <Button className="h-10 flex-1" onClick={() => open(item, 'compra')}>Compra</Button>
              </div>
            </article>
          )
        })}
      </div>

      <h2 className="font-heading mt-8 mb-3 text-2xl">Movimientos</h2>
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Cuándo</th>
              <th className="px-3 py-2 font-medium">Insumo</th>
              <th className="px-3 py-2 font-medium">Cambio</th>
              <th className="px-3 py-2 font-medium">Motivo</th>
              <th className="px-3 py-2 font-medium">Quién</th>
            </tr>
          </thead>
          <tbody>
            {(movementsQuery.data ?? []).map((movement) => (
              <tr key={movement.id} className="border-t border-border">
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(movement.created_at)}</td>
                <td className="px-3 py-2">{movement.inventory_items?.name ?? '—'}</td>
                <td className={movement.change < 0 ? 'px-3 py-2 text-destructive' : 'px-3 py-2 text-emerald-300'}>
                  {movement.change > 0 ? '+' : ''}{formatQty(movement.change)} {movement.inventory_items ? unitLabelSafe(movement.inventory_items.unit) : ''}
                </td>
                <td className="px-3 py-2">
                  {movementLabels[movement.reason]}
                  {movement.note ? <span className="block text-xs text-muted-foreground">{movement.note}</span> : null}
                </td>
                <td className="px-3 py-2">{movement.profiles?.full_name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) setDraft(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.mode === 'compra' ? 'Registrar compra' : 'Actualizar conteo'}</DialogTitle>
            <DialogDescription>
              {draft?.mode === 'compra'
                ? `Suma cantidad a ${draft.item.name}. Si indicas el costo de esta compra, se promedia con el stock actual.`
                : `Deja ${draft?.item.name ?? 'el insumo'} en la cantidad contada.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="stock-amount">{draft?.mode === 'compra' ? 'Cantidad que entra' : 'Stock contado'}</Label>
              <Input id="stock-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </div>
            {draft?.mode === 'compra' ? (
              <div className="grid gap-1.5">
                <Label htmlFor="stock-cost">Costo por unidad de esta compra</Label>
                <Input id="stock-cost" inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="stock-note">Nota</Label>
              <Textarea id="stock-note" value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancelar</Button>
            <Button disabled={adjust.isPending || amount.trim() === ''} onClick={() => adjust.mutate()}>
              {adjust.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function unitLabelSafe(unit: InventoryUnit) {
  return unitOptions.find((option) => option.value === unit)?.label ?? unit
}
