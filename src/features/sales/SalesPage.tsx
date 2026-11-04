import { useMemo, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { asNumber, dayBounds, errorMessage, formatDateTime, formatMoney, todayISO } from '@/lib/format.ts'
import { paymentLabels, roleLabels, saleStatusLabels } from '@/lib/labels.ts'
import { supabase } from '@/lib/supabase.ts'
import type { AppRole, Profile, Sale, SaleStatus } from '@/lib/types.ts'

type RoleFilter = 'todos' | AppRole

function sellerRoleLabel(role: AppRole) {
  if (role === 'portero') return 'Boletería'
  return roleLabels[role]
}

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
  const [userId, setUserId] = useState('todos')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('todos')

  const isAdmin = profile?.role === 'admin'

  const usersQuery = useQuery({
    queryKey: ['profiles'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, email, role, active, created_at').order('full_name')
      if (error) throw new Error(error.message)
      return (data ?? []) as Profile[]
    },
  })

  const visibleUsers = useMemo(() => {
    return (usersQuery.data ?? []).filter((person) => roleFilter === 'todos' || person.role === roleFilter)
  }, [usersQuery.data, roleFilter])

  function changeRole(next: RoleFilter) {
    setRoleFilter(next)
    if (next === 'todos' || userId === 'todos') return
    const person = (usersQuery.data ?? []).find((item) => item.id === userId)
    if (!person || person.role !== next) setUserId('todos')
  }

  const salesQuery = useQuery({
    queryKey: ['sales', date, status, profile?.id, profile?.role, isAdmin ? userId : 'propias', isAdmin ? roleFilter : 'propias'],
    enabled: Boolean(profile) && (!isAdmin || roleFilter === 'todos' || usersQuery.isSuccess),
    queryFn: async () => {
      const { start, end } = dayBounds(date)
      let request = supabase
        .from('sales')
        .select(`
          id, sale_number, created_at, payment_method, subtotal, discount, total, status, note, void_reason, user_id,
          sale_items (id, product_name, variant_name, quantity, unit_price, unit_cost, line_total),
          cashier:profiles!sales_user_id_fkey (full_name)
        `)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false })
      if (!isAdmin && profile) {
        request = request.eq('user_id', profile.id)
      } else if (isAdmin) {
        if (userId !== 'todos') request = request.eq('user_id', userId)
        if (roleFilter !== 'todos') {
          const ids = (usersQuery.data ?? []).filter((person) => person.role === roleFilter).map((person) => person.id)
          if (ids.length === 0) return []
          request = request.in('user_id', ids)
        }
      }
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
        description={isAdmin ? 'Todas las ventas del día elegido.' : 'Tus ventas del día elegido.'}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="sale-date">Día</Label>
          <Input id="sale-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        {isAdmin ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="sale-role">Puesto</Label>
              <Select value={roleFilter} onValueChange={(value) => changeRole(value as RoleFilter)}>
                <SelectTrigger id="sale-role" className="h-11 min-w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="cajero">Cajero</SelectItem>
                  <SelectItem value="portero">Boletería</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sale-user">Usuario</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id="sale-user" className="h-11 min-w-52">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {visibleUsers.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.full_name} · {sellerRoleLabel(person.role)}{person.active ? '' : ' (inactivo)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}
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
      {usersQuery.isError ? <p className="text-sm text-destructive">{errorMessage(usersQuery.error)}</p> : null}
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
                  {isAdmin && sale.cashier ? ` · ${sale.cashier.full_name}` : ''}
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
            {sale.note ? <p className="mt-2 text-sm">Nota: {sale.note}</p> : null}
            {sale.void_reason ? <p className="mt-2 text-sm">Motivo: {sale.void_reason}</p> : null}
            {isAdmin && sale.status === 'completada' ? (
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
