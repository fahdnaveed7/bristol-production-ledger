import { readAll } from './read'
import { supabase } from './supabase'
import type { Profile } from './types'
import { outputKg, yieldPct } from './yield'

// ---- CSV helpers ----
function esc(v: unknown): string {
  if (v == null) return ''
  const raw = String(v)
  const s = typeof v === 'string' && /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
}

export function downloadCsv(filename: string, csv: string) {
  // Prepend BOM so Excel opens UTF-8 cleanly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export interface DateRange {
  from?: string // inclusive business/entry date (YYYY-MM-DD)
  to?: string // inclusive
}

async function profileMap(): Promise<Record<string, string>> {
  const { data } = await readAll(supabase.from('profiles').select('id,name'))
  const m: Record<string, string> = {}
  ;(data as Pick<Profile, 'id' | 'name'>[] | null ?? []).forEach((p) => (m[p.id] = p.name))
  return m
}

// ---- Datasets ----

export async function exportShiftReports(range: DateRange = {}): Promise<{ rows: number; csv: string }> {
  let q = supabase.from('shift_report').select('*').order('business_date', { ascending: true })
  if (range.from) q = q.gte('business_date', range.from)
  if (range.to) q = q.lte('business_date', range.to)
  const { data } = await readAll(q)
  const names = await profileMap()
  const headers = [
    'Business date', 'Shift', 'Opening (kg)', 'Received (kg)', 'Fed (kg)', 'Closing (kg)',
    'Fishmeal (kg)', 'Fish oil (kg)', 'Fishmeal yield %', 'Fish oil yield %',
    'Verified by', 'Generated at',
  ]
  const rows = (data ?? []).map((r) => [
    r.business_date, r.label, r.opening_balance_kg, r.received_kg, r.fed_kg, r.closing_balance_kg,
    r.fishmeal_kg, r.fishoil_kg,
    r.yield_fishmeal_pct?.toFixed?.(2) ?? r.yield_fishmeal_pct,
    r.yield_fishoil_pct?.toFixed?.(2) ?? r.yield_fishoil_pct,
    r.verified_by ? names[r.verified_by] ?? '' : '', r.generated_at,
  ])
  return { rows: rows.length, csv: toCsv(headers, rows) }
}

export async function exportIntake(range: DateRange = {}): Promise<{ rows: number; csv: string }> {
  let q = supabase.from('grn').select('*').order('entry_date', { ascending: true }).order('arrived_at', { ascending: true })
  if (range.from) q = q.gte('entry_date', range.from)
  if (range.to) q = q.lte('entry_date', range.to)
  const { data } = await readAll(q)
  const names = await profileMap()
  const headers = [
    'Entry date', 'Register no', 'Vehicle no', 'Supplier', 'Driver', 'Species', 'Status',
    'Gross (kg)', 'Tare (kg)', 'Net (kg)', 'Total boxes', 'Sample boxes', 'Sample wt (kg)',
    'Avg/box (kg)', 'Box estimate (kg)', 'Weighbridge by', 'Receiving by', 'Received at', 'Remarks',
  ]
  const rows = (data ?? []).map((g) => [
    g.entry_date, g.register_no, g.vehicle_no, g.supplier, g.driver_name, g.species, g.status,
    g.gross_kg, g.tare_kg, g.net_kg, g.total_boxes, g.sample_boxes, g.sample_weight_kg,
    g.avg_box_kg, g.sampled_estimate_kg,
    g.weighbridge_by ? names[g.weighbridge_by] ?? '' : '',
    g.receiving_by ? names[g.receiving_by] ?? '' : '',
    g.received_at, g.remarks,
  ])
  return { rows: rows.length, csv: toCsv(headers, rows) }
}

export async function exportProduction(range: DateRange = {}): Promise<{ rows: number; csv: string }> {
  // One row per output, with its parent batch's details, plus batches with no output yet.
  let bq = supabase.from('batch').select('*,shift:shift_id!inner(business_date)').order('started_at', { ascending: true })
  if (range.from) bq = bq.gte('shift.business_date', range.from)
  if (range.to) bq = bq.lte('shift.business_date', range.to)
  const { data: batches } = await readAll(bq)
  const ids = (batches ?? []).map((b) => b.id)
  let outputs: { batch_id: string; product: string; bags: number | null; kg_per_bag: number | null; total_kg: number | null }[] = []
  if (ids.length) {
    const { data: out } = await readAll(supabase.from('batch_output').select('*').in('batch_id', ids))
    outputs = out ?? []
  }
  const names = await profileMap()
  const headers = [
    'Batch no', 'Started at', 'Operator', 'Raw fed (kg)', 'Species note',
    'Product', 'Bags', 'kg/bag', 'Output (kg)', 'Yield %', 'Remarks',
  ]
  const rows: unknown[][] = []
  for (const b of batches ?? []) {
    const outs = outputs.filter((o) => o.batch_id === b.id && ['fishmeal', 'fishoil'].includes(o.product))
    const op = b.operator_id ? names[b.operator_id] ?? '' : ''
    if (outs.length === 0) {
      rows.push([b.batch_no, b.started_at, op, b.raw_fed_kg, b.species_note, '', '', '', '', '', b.remarks])
    } else {
      for (const o of outs) {
        const okg = outputKg(o)
        const y = b.raw_fed_kg ? yieldPct(okg, b.raw_fed_kg)?.toFixed(2) : ''
        rows.push([b.batch_no, b.started_at, op, b.raw_fed_kg, b.species_note, o.product, o.bags, o.kg_per_bag, okg, y, b.remarks])
      }
    }
  }
  return { rows: rows.length, csv: toCsv(headers, rows) }
}

// Manager-only: rate/amount per truck (RLS blocks non-managers).
export async function exportPricing(range: DateRange = {}): Promise<{ rows: number; csv: string }> {
  const { data: pricing } = await readAll(supabase.from('grn_pricing').select('*'))
  const ids = (pricing ?? []).map((p) => p.grn_id)
  let grns: Record<string, { vehicle_no: string; entry_date: string; net_kg: number | null; supplier: string | null }> = {}
  if (ids.length) {
    const { data: g } = await readAll(supabase.from('grn').select('id,vehicle_no,entry_date,net_kg,supplier').in('id', ids))
    ;(g ?? []).forEach((r) => (grns[r.id] = r))
  }
  const names = await profileMap()
  const headers = ['Entry date', 'Vehicle no', 'Supplier', 'Net (kg)', 'Rate/kg', 'Amount', 'Entered by', 'Entered at']
  const rows = (pricing ?? []).filter((p) => {
    const date = grns[p.grn_id]?.entry_date
    return date && (!range.from || date >= range.from) && (!range.to || date <= range.to)
  }).map((p) => {
    const g = grns[p.grn_id]
    return [g?.entry_date, g?.vehicle_no, g?.supplier, g?.net_kg, p.rate_per_kg, p.amount, p.entered_by ? names[p.entered_by] ?? '' : '', p.entered_at]
  })
  return { rows: rows.length, csv: toCsv(headers, rows) }
}
