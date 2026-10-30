import { Navigate, Route, Routes } from 'react-router'
import { RequireAuth, RequireRole } from '@/auth/guards.tsx'
import { AppShell } from '@/components/layout/AppShell.tsx'
import { LoginPage } from '@/features/auth/LoginPage.tsx'
import { CatalogPage } from '@/features/catalog/CatalogPage.tsx'
import { InventoryPage } from '@/features/inventory/InventoryPage.tsx'
import { KpisPage } from '@/features/kpis/KpisPage.tsx'
import { PosPage } from '@/features/pos/PosPage.tsx'
import { SalesPage } from '@/features/sales/SalesPage.tsx'
import { UsersPage } from '@/features/users/UsersPage.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/facturacion" replace />} />
          <Route path="/facturacion" element={<PosPage />} />
          <Route element={<RequireRole role="admin" />}>
            <Route path="/ventas" element={<SalesPage />} />
            <Route path="/inventario" element={<InventoryPage />} />
            <Route path="/indicadores" element={<KpisPage />} />
            <Route path="/admin/catalogo" element={<CatalogPage />} />
            <Route path="/admin/usuarios" element={<UsersPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/facturacion" replace />} />
    </Routes>
  )
}
