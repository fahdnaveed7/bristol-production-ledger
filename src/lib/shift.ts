import { db } from '../offline/db'
import { readAll } from './read'
import { cachedRows } from '../offline/cache'
import { supabase } from './supabase'
import { uuid, localDate } from './format'
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
  const business_date = localDate(d)
  return { label: isDay ? 'day' : 'night', business_date }
}

export async function getOpenShift(): Promise<Shift | null> {
  const rows = await cachedRows<Shift>('open-shift', supabase.from('shift').select('*').eq('status', 'open'))
  return rows[0] ?? null
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
export async function computeShiftTotals(shift: Shift, requireFresh = false): Promise<ShiftTotals> {
  const [allGrns, allBatches] = await Promise.all([
    cachedRows<Grn>(`shift-grn-${shift.id}`, readAll(supabase.from('grn').select('*').eq('shift_id', shift.id).order('id')), 'grn', requireFresh),
    cachedRows<Batch>(`shift-batch-${shift.id}`, readAll(supabase.from('batch').select('*').eq('shift_id', shift.id).order('id')), 'batch', requireFresh),
  ])
  const grns = allGrns.filter((g) => g.shift_id === shift.id && g.status === 'received')
  const batches = allBatches.filter((b) => b.shift_id === shift.id)
  const received_kg = grns.reduce((s, g) => s + (g.net_kg ?? 0), 0)
  const fed_kg = batches.reduce((s, b) => s + (b.raw_fed_kg ?? 0), 0)
  const batchIds = batches.map((b) => b.id)
  const allOutputs = batchIds.length ? await cachedRows<BatchOutput>(`shift-output-${shift.id}`, readAll(supabase.from('batch_output').select('*').in('batch_id', batchIds).order('id')), 'batch_output', requireFresh) : []
  const outputs = allOutputs.filter((o) => batchIds.includes(o.batch_id))

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

// A saved snapshot is never replaced, including when closing is retried.
// The existing schema has no transactional close RPC: the two writes remain separate.
export async function closeShift(shift: Shift): Promise<void> {
  if (!navigator.onLine) throw new Error('Can you reconnect before ending the shift?')
  if (await db.mutations.count()) throw new Error('Can you wait for saved records to finish syncing before ending the shift?')
  const existing = await supabase.from('shift_report').select('*').eq('shift_id', shift.id).maybeSingle()
  if (existing.error) throw existing.error
  let report = existing.data
  if (!report) {
    const t = await computeShiftTotals(shift, true)
    const snapshot = {
      id: uuid(), shift_id: shift.id, business_date: shift.business_date, label: shift.label,
      opening_balance_kg: shift.opening_balance_kg, ...t, verified_by: null,
    }
    const saved = await supabase.from('shift_report').insert(snapshot).select().single()
    if (saved.error && saved.error.code !== '23505') throw saved.error
    if (saved.error) {
      const winner = await supabase.from('shift_report').select('*').eq('shift_id', shift.id).single()
      if (winner.error) throw winner.error
      report = winner.data
    } else report = saved.data
  }
  const { error } = await supabase.from('shift').update({
    status: 'closed', closing_balance_kg: report.closing_balance_kg,
    ended_at: new Date().toISOString(),
  }).eq('id', shift.id).eq('status', 'open')
  if (error) throw error
}
