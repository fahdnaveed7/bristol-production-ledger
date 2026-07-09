import { supabase } from './supabase'
import { uuid } from './format'
import { outputKg, yieldPct } from './yield'
import type { Shift, Grn, Batch, BatchOutput } from './types'

// Shift clock: day = 08:00–20:00, night = 20:00–08:00.
// business_date = the calendar date the shift's day-portion belongs to.
export function suggestShift(now = new Date()): { label: 'day' | 'night'; business_date: string } {
  const h = now.getHours()
  const isDay = h >= 8 && h < 20
  const d = new Date(now)
  // A night shift running past midnight (00:00–08:00) still belongs to the previous business date.
  if (!isDay && h < 8) d.setDate(d.getDate() - 1)
  const business_date = d.toISOString().slice(0, 10)
  return { label: isDay ? 'day' : 'night', business_date }
}

export async function getOpenShift(): Promise<Shift | null> {
  const { data, error } = await supabase
    .from('shift')
    .select('*')
    .eq('status', 'open')
    .maybeSingle()
  if (error) throw error
  return data as Shift | null
}

export async function getLastClosedShift(): Promise<Shift | null> {
  const { data, error } = await supabase
    .from('shift')
    .select('*')
    .eq('status', 'closed')
    .order('ended_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as Shift | null
}

export async function openShift(
  label: 'day' | 'night',
  business_date: string,
  supervisorId: string | null,
): Promise<Shift> {
  const prev = await getLastClosedShift()
  const opening = prev?.closing_balance_kg ?? 0
  const row = {
    id: uuid(),
    label,
    business_date,
    supervisor_id: supervisorId,
    opening_balance_kg: opening,
    status: 'open' as const,
  }
  const { data, error } = await supabase.from('shift').insert(row).select().single()
  if (error) throw error
  return data as Shift
}

export interface ShiftTotals {
  received_kg: number
  fed_kg: number
  closing_balance_kg: number
  fishmeal_kg: number
  fishoil_kg: number
  fsp_kg: number
  yield_fishmeal_pct: number | null
  yield_fishoil_pct: number | null
  yield_fsp_pct: number | null
}

// Live totals for a shift — used by Shift screen, Dashboard, and at close.
// received = Σ net of GRNs marked received in this shift.
// fed = Σ raw_fed of all batches in this shift (batch boundaries don't matter for the shift roll-up).
export async function computeShiftTotals(shift: Shift): Promise<ShiftTotals> {
  const [{ data: grns }, { data: batches }] = await Promise.all([
    supabase.from('grn').select('*').eq('shift_id', shift.id).eq('status', 'received'),
    supabase.from('batch').select('*').eq('shift_id', shift.id),
  ])

  const received_kg = (grns as Grn[] | null ?? []).reduce((s, g) => s + (g.net_kg ?? 0), 0)
  const fed_kg = (batches as Batch[] | null ?? []).reduce((s, b) => s + (b.raw_fed_kg ?? 0), 0)

  const batchIds = (batches as Batch[] | null ?? []).map((b) => b.id)
  let outputs: BatchOutput[] = []
  if (batchIds.length) {
    const { data: out } = await supabase.from('batch_output').select('*').in('batch_id', batchIds)
    outputs = (out as BatchOutput[] | null) ?? []
  }

  const sumProduct = (p: string) =>
    outputs.filter((o) => o.product === p).reduce((s, o) => s + outputKg(o), 0)

  const fishmeal_kg = sumProduct('fishmeal')
  const fishoil_kg = sumProduct('fishoil')
  const fsp_kg = sumProduct('fsp')

  return {
    received_kg,
    fed_kg,
    closing_balance_kg: (shift.opening_balance_kg ?? 0) + received_kg - fed_kg,
    fishmeal_kg,
    fishoil_kg,
    fsp_kg,
    yield_fishmeal_pct: yieldPct(fishmeal_kg, fed_kg),
    yield_fishoil_pct: yieldPct(fishoil_kg, fed_kg),
    yield_fsp_pct: yieldPct(fsp_kg, fed_kg),
  }
}

// Close a shift: freeze a report snapshot, then mark the shift closed.
// The report is written first so history survives even if the update races a realtime edit.
export async function closeShift(shift: Shift, verifiedBy: string | null): Promise<void> {
  const t = await computeShiftTotals(shift)

  const report = {
    id: uuid(),
    shift_id: shift.id,
    business_date: shift.business_date,
    label: shift.label,
    opening_balance_kg: shift.opening_balance_kg,
    received_kg: t.received_kg,
    fed_kg: t.fed_kg,
    closing_balance_kg: t.closing_balance_kg,
    fishmeal_kg: t.fishmeal_kg,
    fishoil_kg: t.fishoil_kg,
    fsp_kg: t.fsp_kg,
    yield_fishmeal_pct: t.yield_fishmeal_pct,
    yield_fishoil_pct: t.yield_fishoil_pct,
    yield_fsp_pct: t.yield_fsp_pct,
    verified_by: verifiedBy,
  }

  const { error: repErr } = await supabase.from('shift_report').insert(report)
  if (repErr) throw repErr

  const { error: shErr } = await supabase
    .from('shift')
    .update({
      status: 'closed',
      closing_balance_kg: t.closing_balance_kg,
      ended_at: new Date().toISOString(),
    })
    .eq('id', shift.id)
  if (shErr) throw shErr
}
