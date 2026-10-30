import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider.tsx'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { errorMessage, functionErrorMessage } from '@/lib/format.ts'
import { roleLabels } from '@/lib/labels.ts'
import { supabase } from '@/lib/supabase.ts'
import type { AppRole, Profile } from '@/lib/types.ts'

export function UsersPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AppRole>('cajero')

  const usersQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name')
      if (error) throw new Error(error.message)
      return (data ?? []) as Profile[]
    },
  })

  const createUser = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('admin-create-user', {
        body: { email, password, full_name: fullName, role },
      })
      if (error) throw new Error(await functionErrorMessage(error))
    },
    onSuccess: () => {
      toast.success('Usuario creado')
      setOpen(false)
      setFullName('')
      setEmail('')
      setPassword('')
      setRole('cajero')
      void queryClient.invalidateQueries({ queryKey: ['profiles'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const updateUser = useMutation({
    mutationFn: async (change: { id: string; role?: AppRole; active?: boolean }) => {
      const { error } = await supabase.from('profiles').update({
        ...(change.role ? { role: change.role } : {}),
        ...(change.active === undefined ? {} : { active: change.active }),
      }).eq('id', change.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profiles'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  function onCreate(event: FormEvent) {
    event.preventDefault()
    createUser.mutate()
  }

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description="El cajero solo factura. El administrador entra a inventario, indicadores, catálogo y usuarios."
        action={<Button className="h-11" onClick={() => setOpen(true)}>Nuevo usuario</Button>}
      />
      {usersQuery.isError ? <p className="mb-3 text-sm text-destructive">{errorMessage(usersQuery.error)}</p> : null}
      <div className="grid gap-3">
        {(usersQuery.data ?? []).map((person) => {
          const isSelf = person.id === profile?.id
          return (
            <article key={person.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="min-w-40 flex-1">
                <p className="font-medium">{person.full_name}</p>
                <p className="text-sm text-muted-foreground">{person.email}</p>
              </div>
              <Badge variant={person.active ? 'secondary' : 'outline'}>{person.active ? 'Activo' : 'Inactivo'}</Badge>
              <Select
                value={person.role}
                disabled={isSelf || updateUser.isPending}
                onValueChange={(value) => updateUser.mutate({ id: person.id, role: value as AppRole })}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cajero">{roleLabels.cajero}</SelectItem>
                  <SelectItem value="admin">{roleLabels.admin}</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Switch
                  checked={person.active}
                  disabled={isSelf || updateUser.isPending}
                  onCheckedChange={(checked) => updateUser.mutate({ id: person.id, active: checked })}
                  aria-label={`Activar ${person.full_name}`}
                />
                <span className="text-sm text-muted-foreground">{isSelf ? 'Tú' : 'Activo'}</span>
              </div>
            </article>
          )
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo usuario</DialogTitle>
            <DialogDescription>La persona entra con este correo y contraseña. No necesita confirmar el correo.</DialogDescription>
          </DialogHeader>
          <form id="create-user" className="grid gap-3" onSubmit={onCreate}>
            <div className="grid gap-1.5">
              <Label htmlFor="user-name">Nombre</Label>
              <Input id="user-name" value={fullName} onChange={(event) => setFullName(event.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="user-email">Correo</Label>
              <Input id="user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="user-password">Contraseña</Label>
              <Input id="user-password" type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label>Rol</Label>
              <Select value={role} onValueChange={(value) => setRole(value as AppRole)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cajero">{roleLabels.cajero}</SelectItem>
                  <SelectItem value="admin">{roleLabels.admin}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="create-user" className="h-11" disabled={createUser.isPending}>
              {createUser.isPending ? 'Creando…' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
