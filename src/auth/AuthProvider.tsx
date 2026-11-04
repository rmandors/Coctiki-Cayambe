import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { ReactNode } from 'react'
import { isProtectedAccount, readStoredViewRole, storeViewRole } from '@/lib/owner.ts'
import { isSupabaseConfigured, supabase } from '@/lib/supabase.ts'
import type { AppRole, Profile } from '@/lib/types.ts'

type AuthContextValue = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  configured: boolean
  notice: string | null
  canSwitchView: boolean
  setViewRole: (role: AppRole) => void
  clearNotice: () => void
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function mapAuthError(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('invalid') || lower.includes('credentials')) {
    return 'Correo o contraseña incorrectos'
  }
  if (lower.includes('fetch') || lower.includes('network')) {
    return 'No se pudo conectar con Supabase. Revisa la URL y la clave.'
  }
  if (lower.includes('email not confirmed')) {
    return 'Falta confirmar el correo'
  }
  return message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [account, setAccount] = useState<Profile | null>(null)
  const [viewRole, setViewRoleState] = useState<AppRole | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [notice, setNotice] = useState<string | null>(null)
  const canSwitchView = isProtectedAccount(account?.email)
  const profile = account
    ? { ...account, role: canSwitchView ? (viewRole ?? account.role) : account.role }
    : null

  useEffect(() => {
    if (!isSupabaseConfigured) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setAccount(null)
        setViewRoleState(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    if (!session) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    supabase
      .from('profiles')
      .select('id, full_name, email, role, active, created_at')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setNotice('Tu usuario no tiene perfil. Revisa la cuenta en Supabase.')
          setAccount(null)
          setViewRoleState(null)
          void supabase.auth.signOut()
        } else if (!data.active) {
          setNotice('Tu cuenta está desactivada.')
          setAccount(null)
          setViewRoleState(null)
          void supabase.auth.signOut()
        } else {
          const nextAccount = data as Profile
          setAccount(nextAccount)
          setViewRoleState(isProtectedAccount(nextAccount.email) ? (readStoredViewRole() ?? nextAccount.role) : null)
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [session])

  const value = useMemo<AuthContextValue>(() => ({
    session,
    profile,
    loading,
    configured: isSupabaseConfigured,
    notice,
    canSwitchView,
    setViewRole: (role) => {
      if (!isProtectedAccount(account?.email)) return
      setViewRoleState(role)
      storeViewRole(role)
    },
    clearNotice: () => setNotice(null),
    signIn: async (email, password) => {
      setNotice(null)
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (error) throw new Error(mapAuthError(error.message))
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }), [session, profile, loading, notice, canSwitchView, account?.email])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
