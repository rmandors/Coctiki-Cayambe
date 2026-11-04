import type { AppRole } from '@/lib/types.ts'

export const protectedEmail = 'raymond-admin@coctiki.com'

export const viewRoleLabels: Record<AppRole, string> = {
  portero: 'Boletería',
  cajero: 'Ventas',
  admin: 'Administrador',
}

export const viewRoles = Object.keys(viewRoleLabels) as AppRole[]

const viewRoleKey = 'coctiki-view-role'

export function isProtectedAccount(email: string | null | undefined) {
  return email?.trim().toLowerCase() === protectedEmail
}

export function readStoredViewRole(): AppRole | null {
  const stored = localStorage.getItem(viewRoleKey)
  if (stored === 'portero' || stored === 'cajero' || stored === 'admin') return stored
  return null
}

export function storeViewRole(role: AppRole) {
  localStorage.setItem(viewRoleKey, role)
}
