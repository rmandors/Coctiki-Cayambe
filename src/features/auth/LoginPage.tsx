import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '@/auth/AuthProvider.tsx'
import { BrandMark } from '@/components/brand.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { errorMessage } from '@/lib/format.ts'

export function LoginPage() {
  const { configured, session, profile, loading, notice, clearNotice, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!loading && session && profile) return <Navigate to="/facturacion" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    clearNotice()
    setPending(true)
    try {
      await signIn(email, password)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-14" />
          <h1 className="font-heading mt-4 text-4xl">Coctiki</h1>
          <p className="mt-1 text-sm tracking-[0.18em] text-muted-foreground uppercase">Cayambe</p>
        </div>
        <div className="rounded-3xl border border-border bg-card p-6 shadow-2xl shadow-black/20">
          {!configured ? (
            <div className="space-y-3 text-sm">
              <p className="font-medium">Falta conectar Supabase.</p>
              <p className="text-muted-foreground">
                Crea un archivo <code className="text-foreground">.env</code> en la raíz del proyecto con
                {' '}
                <code className="text-foreground">VITE_SUPABASE_URL</code> y
                {' '}
                <code className="text-foreground">VITE_SUPABASE_ANON_KEY</code>, y reinicia el servidor.
              </p>
            </div>
          ) : (
            <form className="grid gap-4" onSubmit={onSubmit}>
              <div className="grid gap-2">
                <Label htmlFor="email">Correo</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              {notice ? <p className="text-sm text-amber-200">{notice}</p> : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="h-12 text-base" disabled={pending}>
                {pending ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
