import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider.tsx'
import { EmptyState, PageHeader } from '@/components/feedback.tsx'
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
import { asNumber, dayBounds, errorMessage, formatDateTime, formatMoney, todayISO } from '@/lib/format.ts'
import { paymentLabels, saleStatusLabels } from '@/lib/labels.ts'
import { supabase } from '@/lib/supabase.ts'
import type { Sale, SaleStatus } from '@/lib/types.ts'

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function mapSale(row: Sale): Sale {
  return {
    ...row,
    sale_number: asNumber(row.sale_number),
    subtotal: asNumber(row.subtotal),
    discount: asNumber(row.discount),
    total: asNumber(row.total),
    cashier: one(row.cashier),
    sale_items: (row.sale_items ?? []).map((item) => ({
      ...item,
      quantity: asNumber(item.quantity),
      unit_price: asNumber(item.unit_price),
      unit_cost: asNumber(item.unit_cost),
      line_total: asNumber(item.line_total),
    })),
  }
}

export function SalesPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [date, setDate] = useState(todayISO())
  const [status, setStatus] = useState<'todas' | SaleStatus>('todas')
  const [voiding, setVoiding] = useState<Sale | null>(null)
  const [reason, setReason] = useState('')

  const salesQuery = useQuery({
    queryKey: ['sales', date, status, profile?.id],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { start, end } = dayBounds(date)
      let request = supabase
        .from('sales')
        .select(`
          id, sale_number, created_at, payment_method, subtotal, discount, total, status, void_reason, user_id,
          sale_items (id, product_name, variant_name, quantity, unit_price, unit_cost, line_total),
          cashier:profiles!sales_user_id_fkey (full_name)
        `)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false })
      if (status !== 'todas') request = request.eq('status', status)
      const { data, error } = await request
      if (error) throw new Error(error.message)
      return ((data ?? []) as unknown as Sale[]).map(mapSale)
    },
  })

  const voidSale = useMutation({
    mutationFn: async () => {
      if (!voiding) return
      const { error } = await supabase.rpc('void_sale', {
        p_sale_id: voiding.id,
        p_reason: reason.trim(),
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success('Venta anulada y stock devuelto')
      setVoiding(null)
      setReason('')
      void queryClient.invalidateQueries({ queryKey: ['sales'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['kpis'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const sales = salesQuery.data ?? []
  const dayTotal = sales.filter((sale) => sale.status === 'completada').reduce((sum, sale) => sum + sale.total, 0)

  return (
    <div>
      <PageHeader
        title="Ventas"
        description={profile?.role === 'admin' ? 'Todas las ventas del día elegido.' : 'Tus ventas del día elegido.'}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="sale-date">Día</Label>
          <Input id="sale-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div className="flex gap-2">
          {(['todas', 'completada', 'anulada'] as const).map((value) => (
            <Button
              key={value}
              variant={status === value ? 'default' : 'outline'}
              className="h-11"
              onClick={() => setStatus(value)}
            >
              {value === 'todas' ? 'Todas' : saleStatusLabels[value]}
            </Button>
          ))}
        </div>
        <p className="ml-auto text-sm text-muted-foreground">
          Cobradas: <span className="font-medium text-foreground">{formatMoney(dayTotal)}</span>
        </p>
      </div>
      {salesQuery.isLoading ? <p className="text-sm text-muted-foreground">Cargando ventas…</p> : null}
      {salesQuery.isError ? <p className="text-sm text-destructive">{errorMessage(salesQuery.error)}</p> : null}
      {!salesQuery.isLoading && sales.length === 0 ? (
        <EmptyState title="Sin ventas" detail="No hay ventas para ese filtro." />
      ) : null}
      <div className="grid gap-3">
        {sales.map((sale) => (
          <article key={sale.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-heading text-xl">#{String(sale.sale_number).padStart(4, '0')}</p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(sale.created_at)}
                  {profile?.role === 'admin' && sale.cashier ? ` · ${sale.cashier.full_name}` : ''}
                  {' · '}
                  {paymentLabels[sale.payment_method]}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold">{formatMoney(sale.total)}</p>
                <Badge variant={sale.status === 'anulada' ? 'destructive' : 'secondary'}>
                  {saleStatusLabels[sale.status]}
                </Badge>
              </div>
            </div>
            <ul className="mt-3 grid gap-1 text-sm">
              {sale.sale_items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3">
                  <span>{item.quantity} {item.product_name}{item.variant_name ? ` · ${item.variant_name}` : ''}</span>
                  <span>{formatMoney(item.line_total)}</span>
                </li>
              ))}
            </ul>
            {sale.discount > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Descuento {formatMoney(sale.discount)}</p>
            ) : null}
            {sale.void_reason ? <p className="mt-2 text-sm">Motivo: {sale.void_reason}</p> : null}
            {profile?.role === 'admin' && sale.status === 'completada' ? (
              <Button variant="destructive" className="mt-3 h-10" onClick={() => { setVoiding(sale); setReason('') }}>
                <Ban /> Anular
              </Button>
            ) : null}
          </article>
        ))}
      </div>

      <Dialog open={voiding !== null} onOpenChange={(open) => { if (!open) setVoiding(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular venta #{voiding ? String(voiding.sale_number).padStart(4, '0') : ''}</DialogTitle>
            <DialogDescription>El stock de los insumos vuelve al inventario.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="void-reason">Motivo</Label>
            <Textarea id="void-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. pedido equivocado" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={reason.trim().length < 3 || voidSale.isPending} onClick={() => voidSale.mutate()}>
              {voidSale.isPending ? 'Anulando…' : 'Anular venta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
