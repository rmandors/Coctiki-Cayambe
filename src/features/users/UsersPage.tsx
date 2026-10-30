import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider.tsx'
import { PageHeader } from '@/components/feedback.tsx'
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

const roles: AppRole[] = ['cajero', 'portero', 'admin']

export function UsersPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AppRole>('cajero')
  const [removing, setRemoving] = useState<Profile | null>(null)

  const usersQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name')
      if (error) throw new Error(error.message)
      return (data ?? []) as Profile[]
    },
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['profiles'] })
  }

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
      refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const updateUser = useMutation({
    mutationFn: async (change: { id: string; role?: AppRole; active?: boolean; full_name?: string }) => {
      const { error } = await supabase.from('profiles').update({
        ...(change.role ? { role: change.role } : {}),
        ...(change.active === undefined ? {} : { active: change.active }),
        ...(change.full_name === undefined ? {} : { full_name: change.full_name }),
      }).eq('id', change.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => refresh(),
    onError: (error) => toast.error(errorMessage(error)),
  })

  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.functions.invoke('admin-create-user', {
        body: { action: 'delete', id },
      })
      if (error) throw new Error(await functionErrorMessage(error))
    },
    onSuccess: () => {
      toast.success('Usuario eliminado')
      setRemoving(null)
      refresh()
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
        description="El cajero factura el menú, sin entradas ni barra libre. Portería solo vende esas dos. El administrador ve todo."
        action={<Button className="h-11" onClick={() => setOpen(true)}>Nuevo usuario</Button>}
      />
      {usersQuery.isError ? <p className="mb-3 text-sm text-destructive">{errorMessage(usersQuery.error)}</p> : null}
      <div className="grid gap-3">
        {(usersQuery.data ?? []).map((person) => (
          <UserRow
            key={`${person.id}:${person.full_name}:${person.role}:${person.active}`}
            person={person}
            isSelf={person.id === profile?.id}
            pending={updateUser.isPending || deleteUser.isPending}
            onRename={(fullName) => updateUser.mutate({ id: person.id, full_name: fullName })}
            onRole={(next) => updateUser.mutate({ id: person.id, role: next })}
            onActive={(active) => updateUser.mutate({ id: person.id, active })}
            onDelete={() => setRemoving(person)}
          />
        ))}
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
              <RoleSelect value={role} onChange={setRole} />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="create-user" className="h-11" disabled={createUser.isPending}>
              {createUser.isPending ? 'Creando…' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(next) => { if (!next) setRemoving(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar usuario</DialogTitle>
            <DialogDescription>
              {removing ? `${removing.full_name} ya no podrá entrar. Sus ventas quedan en el historial.` : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={deleteUser.isPending || !removing}
              onClick={() => { if (removing) deleteUser.mutate(removing.id) }}
            >
              {deleteUser.isPending ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RoleSelect({ value, onChange, disabled }: { value: AppRole; onChange: (role: AppRole) => void; disabled?: boolean }) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as AppRole)}>
      <SelectTrigger className="w-full sm:w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((item) => (
          <SelectItem key={item} value={item}>{roleLabels[item]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function UserRow({
  person,
  isSelf,
  pending,
  onRename,
  onRole,
  onActive,
  onDelete,
}: {
  person: Profile
  isSelf: boolean
  pending: boolean
  onRename: (fullName: string) => void
  onRole: (role: AppRole) => void
  onActive: (active: boolean) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(person.full_name)
  const trimmed = name.trim()
  const dirty = trimmed !== person.full_name

  return (
    <article className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label={`Nombre de ${person.full_name}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="max-w-xs"
          />
          <Button
            variant="outline"
            className="h-11"
            disabled={!dirty || trimmed.length < 2 || pending}
            onClick={() => onRename(trimmed)}
          >
            Renombrar
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{person.email}{isSelf ? ' · Tú' : ''}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <RoleSelect value={person.role} disabled={isSelf || pending} onChange={onRole} />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={person.active}
            disabled={isSelf || pending}
            onCheckedChange={onActive}
            aria-label={`Activar ${person.full_name}`}
          />
          Activo
        </label>
        <Button variant="outline" className="h-11" disabled={isSelf || pending} onClick={onDelete}>
          Eliminar
        </Button>
      </div>
    </article>
  )
}
