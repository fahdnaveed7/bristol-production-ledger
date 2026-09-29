import { readAll } from './read'
import { supabase } from './supabase'
import { outputKg } from './yield'
import type { Product } from './types'

// One production-day line in the stock register.
export interface StockDay {
  date: string // business date the product was made
  label: string // day / night
  fishmealBags: number
  fishmealKg: number
  fishoilKg: number
}

interface OutputRow {
  product: Product
  bags: number | null
  kg_per_bag: number | null
  total_kg: number | null
  created_at: string | null
  batch: {
    shift: { business_date: string; label: string } | null
  } | null
}

// Everything ever produced, grouped by production date + shift.
export async function fetchStock(): Promise<{ days: StockDay[]; totals: StockDay }> {
  const { data } = await readAll(supabase
    .from('batch_output')
    .select('product,bags,kg_per_bag,total_kg,created_at,batch:batch_id(shift:shift_id(business_date,label))')
    .order('created_at', { ascending: false }))

  const map = new Map<string, StockDay>()
  for (const raw of (data ?? []) as unknown as OutputRow[]) {
    if (raw.product !== 'fishmeal' && raw.product !== 'fishoil') continue
    const date = raw.batch?.shift?.business_date ?? raw.created_at?.slice(0, 10) ?? '—'
    const label = raw.batch?.shift?.label ?? ''
    const key = `${date}|${label}`
    const row = map.get(key) ?? { date, label, fishmealBags: 0, fishmealKg: 0, fishoilKg: 0 }
    const kgVal = outputKg(raw)
    if (raw.product === 'fishmeal') {
      row.fishmealKg += kgVal
      row.fishmealBags += raw.bags ?? 0
    } else if (raw.product === 'fishoil') {
      row.fishoilKg += kgVal
    }
    map.set(key, row)
  }

  const days = [...map.values()].sort((a, b) => (b.date + b.label).localeCompare(a.date + a.label))
  const totals = days.reduce(
    (t, d) => ({
      ...t,
      fishmealBags: t.fishmealBags + d.fishmealBags,
      fishmealKg: t.fishmealKg + d.fishmealKg,
      fishoilKg: t.fishoilKg + d.fishoilKg,
    }),
    { date: 'Total', label: '', fishmealBags: 0, fishmealKg: 0, fishoilKg: 0 } as StockDay,
  )
  return { days, totals }
}
