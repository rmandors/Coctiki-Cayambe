export type AppRole = 'cajero' | 'portero' | 'admin'
export type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta'
export type SaleStatus = 'completada' | 'anulada'
export type MovementReason = 'venta' | 'anulacion' | 'ajuste' | 'compra'
export type InventoryUnit = 'galon' | 'litro' | 'ml' | 'kg' | 'g' | 'unidad'
export type StockLevel = 'negativo' | 'bajo'

export type Profile = {
  id: string
  full_name: string
  email: string
  role: AppRole
  active: boolean
  created_at: string
}

export type InventoryItem = {
  id: string
  name: string
  unit: InventoryUnit
  stock: number
  min_stock: number
  unit_cost: number
  active: boolean
  created_at: string
}

export type ProductVariant = {
  id: string
  product_id: string
  name: string
  price: number | null
  active: boolean
}

export type PriceTier = {
  quantity: number
  total_price: number
}

export type Product = {
  id: string
  name: string
  category: string
  price: number
  active: boolean
  requires_variant: boolean
  door_only: boolean
  created_at: string
  product_variants: ProductVariant[]
  product_price_tiers?: PriceTier[]
}

export type RecipeItem = {
  id: string
  product_id: string
  variant_id: string | null
  inventory_item_id: string
  quantity: number
}

export type SaleItem = {
  id: string
  product_name: string
  variant_name: string | null
  quantity: number
  unit_price: number
  unit_cost: number
  line_total: number
}

export type Sale = {
  id: string
  sale_number: number
  created_at: string
  payment_method: PaymentMethod
  subtotal: number
  discount: number
  total: number
  status: SaleStatus
  void_reason: string | null
  user_id: string
  sale_items: SaleItem[]
  cashier: { full_name: string } | null
}

export type InventoryMovement = {
  id: string
  change: number
  reason: MovementReason
  note: string | null
  created_at: string
  inventory_items: { name: string; unit: InventoryUnit } | null
  profiles: { full_name: string } | null
}

export type StockWarning = {
  item_id: string
  item_name: string
  unit: InventoryUnit
  stock: number
  min_stock: number
  level: StockLevel
}

export type SaleResult = {
  sale_id: string
  sale_number: number
  created_at: string
  subtotal: number
  discount: number
  total: number
  payment_method: PaymentMethod
  warnings: StockWarning[]
}

export type KpiDay = {
  day: string
  revenue: number
  cost: number
  sales_count: number
}

export type KpiPayment = {
  method: PaymentMethod
  revenue: number
  sales_count: number
}

export type KpiProduct = {
  name: string
  variant: string | null
  quantity: number
  revenue: number
  cost: number
}

export type Kpis = {
  sales_count: number
  revenue: number
  discounts: number
  cost: number
  profit: number
  margin_pct: number
  avg_ticket: number
  by_day: KpiDay[]
  by_payment: KpiPayment[]
  top_products: KpiProduct[]
}

export type CartLine = {
  key: string
  productId: string
  variantId: string | null
  name: string
  variantName: string | null
  unitPrice: number
  quantity: number
}
