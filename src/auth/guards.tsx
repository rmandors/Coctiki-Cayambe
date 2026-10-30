import { Navigate, Outlet } from 'react-router'
import { FullScreenLoader } from '@/components/feedback.tsx'
import type { AppRole } from '@/lib/types.ts'
import { useAuth } from '@/auth/AuthProvider.tsx'

export function RequireAuth() {
  const { session, profile, loading, configured } = useAuth()
  if (!configured) return <Navigate to="/login" replace />
  if (loading) return <FullScreenLoader />
  if (!session || !profile) return <Navigate to="/login" replace />
  return <Outlet />
}

export function RequireRole({ role }: { role: AppRole }) {
  const { profile, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role !== role) return <Navigate to="/facturacion" replace />
  return <Outlet />
}
