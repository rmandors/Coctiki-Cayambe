import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import {
  BookOpen,
  ChartColumn,
  GlassWater,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider.tsx'
import { BrandMark } from '@/components/brand.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet.tsx'
import { roleLabels } from '@/lib/labels.ts'
import type { AppRole } from '@/lib/types.ts'
import { cn } from '@/lib/utils.ts'

const links: { to: string; label: string; icon: LucideIcon; roles: AppRole[] }[] = [
  { to: '/facturacion', label: 'Facturación', icon: GlassWater, roles: ['cajero', 'admin'] },
  { to: '/ventas', label: 'Ventas', icon: ReceiptText, roles: ['cajero', 'admin'] },
  { to: '/inventario', label: 'Inventario', icon: Package, roles: ['admin'] },
  { to: '/indicadores', label: 'Indicadores', icon: ChartColumn, roles: ['admin'] },
  { to: '/admin/catalogo', label: 'Catálogo', icon: BookOpen, roles: ['admin'] },
  { to: '/admin/usuarios', label: 'Usuarios', icon: Users, roles: ['admin'] },
]

function NavItems({ items, onNavigate }: { items: typeof links; onNavigate?: () => void }) {
  return (
    <nav className="grid gap-1">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
        >
          <item.icon className="size-4" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function AppShell() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const visible = links.filter((item) => profile && item.roles.includes(profile.role))

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)}>
            <Menu />
            <span className="sr-only">Abrir menú</span>
          </Button>
          <button type="button" className="flex items-center gap-2" onClick={() => navigate('/facturacion')}>
            <BrandMark className="size-8" />
            <span className="font-heading text-lg leading-none">Coctiki</span>
          </button>
          <span className="hidden text-sm text-muted-foreground sm:inline">Cayambe</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{profile?.full_name}</p>
              <p className="text-xs text-muted-foreground">{profile ? roleLabels[profile.role] : ''}</p>
            </div>
            <Badge variant="secondary" className="sm:hidden">
              {profile ? roleLabels[profile.role] : ''}
            </Badge>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void signOut()}
              aria-label="Cerrar sesión"
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden px-4 py-5 md:block">
          <NavItems items={visible} />
        </aside>
        <main className="min-w-0 px-4 py-5 md:px-6 md:py-6">
          <Outlet />
        </main>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72">
          <SheetHeader>
            <SheetTitle className="font-heading">Coctiki</SheetTitle>
          </SheetHeader>
          <NavItems items={visible} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}
