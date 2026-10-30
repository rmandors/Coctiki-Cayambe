import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { ReactNode } from 'react'
import { isSupabaseConfigured, supabase } from '@/lib/supabase.ts'
import type { Profile } from '@/lib/types.ts'

type AuthContextValue = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  configured: boolean
  notice: string | null
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
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) setProfile(null)
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
          setProfile(null)
          void supabase.auth.signOut()
        } else if (!data.active) {
          setNotice('Tu cuenta está desactivada.')
          setProfile(null)
          void supabase.auth.signOut()
        } else {
          setProfile(data as Profile)
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
  }), [session, profile, loading, notice])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
