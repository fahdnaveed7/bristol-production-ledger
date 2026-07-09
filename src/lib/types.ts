export type Role = 'weighbridge' | 'receiving' | 'production' | 'qc' | 'manager'

export type GrnStatus =
  | 'weighed_gross'
  | 'sampling'
  | 'weighed_tare'
  | 'received'
  | 'rejected'

export type Product = 'fishmeal' | 'fishoil' | 'fsp'

export interface Profile {
  id: string
  name: string
  role: Role
  created_at: string
}

export interface Shift {
  id: string
  label: 'day' | 'night'
  business_date: string
  started_at: string
  ended_at: string | null
  supervisor_id: string | null
  opening_balance_kg: number
  closing_balance_kg: number | null
  status: 'open' | 'closed'
  created_at: string | null
}

export interface Grn {
  id: string
  register_no: string | null
  entry_date: string
  shift_id: string | null
  vehicle_no: string
  supplier: string | null
  driver_name: string | null
  species: string | null
  gross_kg: number | null
  tare_kg: number | null
  net_kg: number | null // generated
  total_boxes: number | null
  sample_boxes: number | null
  sample_weight_kg: number | null
  avg_box_kg: number | null // generated
  sampled_estimate_kg: number | null // generated
  status: GrnStatus
  weighbridge_by: string | null
  receiving_by: string | null
  arrived_at: string | null
  received_at: string | null
  remarks: string | null
}

export interface GrnPricing {
  grn_id: string
  rate_per_kg: number | null
  amount: number | null
  entered_by: string | null
  entered_at: string | null
}

export interface Batch {
  id: string
  batch_no: string
  shift_id: string | null
  raw_fed_kg: number | null
  species_note: string | null
  operator_id: string | null
  started_at: string | null
  ended_at: string | null
  remarks: string | null
}

export interface BatchOutput {
  id: string
  batch_id: string
  product: Product
  bags: number | null
  kg_per_bag: number | null
  total_kg: number | null
  created_at: string | null
}

export interface ShiftReport {
  id: string
  shift_id: string
  business_date: string | null
  label: string | null
  opening_balance_kg: number | null
  received_kg: number | null
  fed_kg: number | null
  closing_balance_kg: number | null
  fishmeal_kg: number | null
  fishoil_kg: number | null
  fsp_kg: number | null
  yield_fishmeal_pct: number | null
  yield_fishoil_pct: number | null
  yield_fsp_pct: number | null
  verified_by: string | null
  generated_at: string | null
}

export const PRODUCTS: Product[] = ['fishmeal', 'fishoil', 'fsp']

// Products currently surfaced in the UI. FSP is parked for now (schema keeps its
// columns so it can be switched back on by adding 'fsp' here).
export const ACTIVE_PRODUCTS: Product[] = ['fishmeal', 'fishoil']

export const PRODUCT_LABEL: Record<Product, string> = {
  fishmeal: 'Fishmeal',
  fishoil: 'Fish Oil',
  fsp: 'FSP (Fish Soluble Paste)',
}

export const ROLE_LABEL: Record<Role, string> = {
  weighbridge: 'Weighbridge',
  receiving: 'Receiving',
  production: 'Production',
  qc: 'QC',
  manager: 'Manager',
}

// Status badges say what happens NEXT, in plain words.
export const GRN_STATUS_LABEL: Record<GrnStatus, string> = {
  weighed_gross: 'Next: count boxes',
  sampling: 'Next: weigh empty truck',
  weighed_tare: 'Next: confirm received',
  received: 'Received',
  rejected: 'Rejected',
}
