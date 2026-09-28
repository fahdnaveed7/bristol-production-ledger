import { readAll } from './read'
import { supabase } from './supabase'
import type { DateRange } from './export'
import { fetchStock } from './stock'
import { outputKg, yieldPct } from './yield'
import type { Profile } from './types'

// Brand colours for the workbook (ARGB).
const NAVY = 'FF1A293C'
const GOLD = 'FFA87A3D'
const CREAM = 'FFF4F2E8'

const KG = '#,##0'
const PCT = '0.0"%"'
const MONEY = '#,##0.00'

interface ColDef {
  header: string
  width: number
  numFmt?: string
}

async function names(): Promise<Record<string, string>> {
  const { data } = await readAll(supabase.from('profiles').select('id,name'))
  const m: Record<string, string> = {}
  ;(data as Pick<Profile, 'id' | 'name'>[] | null ?? []).forEach((p) => (m[p.id] = p.name))
  return m
}

// One neatly formatted workbook with everything in it.
export async function exportExcelWorkbook(range: DateRange = {}): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Bristol Proteins & Oils — Production Ledger'
  wb.created = new Date()

  const who = await names()
  const nameOf = (id: string | null) => (id ? who[id] ?? '' : '')

  // ---- shared sheet builder: title band + styled header + striped rows ----
  function addSheet(title: string, cols: ColDef[], rows: (string | number | null)[][], note?: string) {
    const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 4 }] })
    ws.columns = cols.map((c) => ({ width: c.width }))

    // Title band
    ws.mergeCells(1, 1, 1, cols.length)
    const t = ws.getCell(1, 1)
    t.value = 'Bristol Proteins & Oils'
    t.font = { bold: true, size: 14, color: { argb: NAVY } }
    ws.mergeCells(2, 1, 2, cols.length)
    const st = ws.getCell(2, 1)
    st.value = `${title}${range.from || range.to ? ` · ${range.from ?? 'start'} to ${range.to ?? 'today'}` : ''}${note ? ` · ${note}` : ''}`
    st.font = { size: 10, color: { argb: GOLD } }
    ws.getRow(3).height = 4

    // Header row
    const head = ws.getRow(4)
    cols.forEach((c, i) => {
      const cell = head.getCell(i + 1)
      cell.value = c.header
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
      cell.alignment = { vertical: 'middle', wrapText: true }
      cell.border = { bottom: { style: 'thin', color: { argb: GOLD } } }
    })
    head.height = 22

    // Data rows, striped
    rows.forEach((r, ri) => {
      const row = ws.getRow(5 + ri)
      r.forEach((v, ci) => {
        const cell = row.getCell(ci + 1)
        cell.value = v
        if (cols[ci].numFmt && typeof v === 'number') cell.numFmt = cols[ci].numFmt
        if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } }
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFDDDDDD' } } }
      })
    })

    if (rows.length === 0) {
      ws.getCell(5, 1).value = '(no data in this range)'
      ws.getCell(5, 1).font = { italic: true, color: { argb: 'FF999999' } }
    }
    return ws
  }

  // ---- 1 · Shift reports ----
  {
    let q = supabase.from('shift_report').select('*').order('business_date', { ascending: true })
    if (range.from) q = q.gte('business_date', range.from)
    if (range.to) q = q.lte('business_date', range.to)
    const { data } = await readAll(q)
    addSheet(
      'Shift Reports',
      [
        { header: 'Date', width: 12 },
        { header: 'Shift', width: 8 },
        { header: 'Opened with (kg)', width: 16, numFmt: KG },
        { header: 'Trucks brought (kg)', width: 18, numFmt: KG },
        { header: 'Fed to plant (kg)', width: 16, numFmt: KG },
        { header: 'Infeed area left (kg)', width: 18, numFmt: KG },
        { header: 'Fishmeal (kg)', width: 14, numFmt: KG },
        { header: 'Fish oil (kg)', width: 13, numFmt: KG },
        { header: 'Meal yield', width: 11, numFmt: PCT },
        { header: 'Oil yield', width: 11, numFmt: PCT },
        { header: 'Verified by', width: 16 },
      ],
      (data ?? []).map((r) => [
        r.business_date, r.label, r.opening_balance_kg, r.received_kg, r.fed_kg, r.closing_balance_kg,
        r.fishmeal_kg, r.fishoil_kg, r.yield_fishmeal_pct, r.yield_fishoil_pct, nameOf(r.verified_by),
      ]),
      'one locked report per shift',
    )
  }

  // ---- 2 · Trucks ----
  {
    let q = supabase.from('grn').select('*').order('entry_date', { ascending: true }).order('arrived_at', { ascending: true })
    if (range.from) q = q.gte('entry_date', range.from)
    if (range.to) q = q.lte('entry_date', range.to)
    const { data } = await readAll(q)
    addSheet(
      'Trucks',
      [
        { header: 'Date', width: 12 },
        { header: 'Register no', width: 12 },
        { header: 'Vehicle', width: 14 },
        { header: 'Supplier', width: 18 },
        { header: 'Driver', width: 14 },
        { header: 'Fish type', width: 12 },
        { header: 'Status', width: 12 },
        { header: 'Loaded (kg)', width: 12, numFmt: KG },
        { header: 'Empty (kg)', width: 12, numFmt: KG },
        { header: 'Net (kg)', width: 12, numFmt: KG },
        { header: 'Boxes', width: 9, numFmt: KG },
        { header: 'Boxes estimate (kg)', width: 18, numFmt: KG },
        { header: 'Weighed by', width: 16 },
        { header: 'Boxes by', width: 16 },
      ],
      (data ?? []).map((g) => [
        g.entry_date, g.register_no, g.vehicle_no, g.supplier, g.driver_name, g.species,
        g.status === 'received' ? 'Received' : g.status === 'rejected' ? 'Rejected' : 'In progress',
        g.gross_kg, g.tare_kg, g.net_kg, g.total_boxes, g.sampled_estimate_kg,
        nameOf(g.weighbridge_by), nameOf(g.receiving_by),
      ]),
    )
  }

  // ---- 3 · Production ----
  {
    let q = supabase.from('batch').select('*,shift:shift_id!inner(business_date)').order('started_at', { ascending: true })
    if (range.from) q = q.gte('shift.business_date', range.from)
    if (range.to) q = q.lte('shift.business_date', range.to)
    const { data: batches } = await readAll(q)
    const ids = (batches ?? []).map((b) => b.id)
    const { data: outs } = ids.length
      ? await readAll(supabase.from('batch_output').select('*').in('batch_id', ids))
      : { data: [] }
    const rows: (string | number | null)[][] = []
    for (const b of batches ?? []) {
      const bo = (outs ?? []).filter((o) => o.batch_id === b.id)
      const meal = bo.filter((o) => o.product === 'fishmeal').reduce((s, o) => s + outputKg(o), 0)
      const mealBags = bo.filter((o) => o.product === 'fishmeal').reduce((s, o) => s + (o.bags ?? 0), 0)
      const oil = bo.filter((o) => o.product === 'fishoil').reduce((s, o) => s + outputKg(o), 0)
      rows.push([
        b.batch_no,
        b.shift.business_date,
        nameOf(b.operator_id),
        b.raw_fed_kg,
        b.species_note,
        mealBags || null,
        meal || null,
        oil || null,
        yieldPct(meal, b.raw_fed_kg),
        yieldPct(oil, b.raw_fed_kg),
      ])
    }
    addSheet(
      'Production',
      [
        { header: 'Feed no', width: 10 },
        { header: 'Date', width: 12 },
        { header: 'Operator', width: 16 },
        { header: 'Fed (kg)', width: 12, numFmt: KG },
        { header: 'Fish type', width: 12 },
        { header: 'Meal bags', width: 11, numFmt: KG },
        { header: 'Fishmeal (kg)', width: 14, numFmt: KG },
        { header: 'Fish oil (kg)', width: 13, numFmt: KG },
        { header: 'Meal yield', width: 11, numFmt: PCT },
        { header: 'Oil yield', width: 11, numFmt: PCT },
      ],
      rows,
    )
  }

  // ---- 4 · Stock register ----
  {
    const { days } = await fetchStock()
    const inRange = days.filter(
      (d) => (!range.from || d.date >= range.from) && (!range.to || d.date <= range.to),
    )
    const totals = inRange.reduce((t, d) => ({ fishmealBags: t.fishmealBags + d.fishmealBags, fishmealKg: t.fishmealKg + d.fishmealKg, fishoilKg: t.fishoilKg + d.fishoilKg }), { fishmealBags: 0, fishmealKg: 0, fishoilKg: 0 })
    const rows = inRange.map((d) => [d.date, d.label, d.fishmealBags || null, d.fishmealKg || null, d.fishoilKg || null])
    const ws = addSheet(
      'Stock Register',
      [
        { header: 'Produced on', width: 13 },
        { header: 'Shift', width: 8 },
        { header: 'Fishmeal bags', width: 14, numFmt: KG },
        { header: 'Fishmeal (kg)', width: 14, numFmt: KG },
        { header: 'Fish oil (kg)', width: 13, numFmt: KG },
      ],
      rows,
    )
    // Totals row in gold
    const tr = ws.getRow(5 + rows.length + (rows.length ? 0 : 1))
    const tvals = ['Total', '', totals.fishmealBags, totals.fishmealKg, totals.fishoilKg]
    tvals.forEach((v, i) => {
      const c = tr.getCell(i + 1)
      c.value = v as string | number
      c.font = { bold: true, color: { argb: NAVY } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3ECDD' } }
      if (i >= 2 && typeof v === 'number') c.numFmt = KG
      c.border = { top: { style: 'thin', color: { argb: GOLD } } }
    })
  }

  // ---- 5 · Pricing (only returns rows for managers — RLS) ----
  {
    const { data: pricing } = await readAll(supabase.from('grn_pricing').select('*'))
    const ids = (pricing ?? []).map((p) => p.grn_id)
    const grnById: Record<string, { entry_date: string; vehicle_no: string; supplier: string | null; net_kg: number | null }> = {}
    if (ids.length) {
      const { data: g } = await readAll(supabase.from('grn').select('id,entry_date,vehicle_no,supplier,net_kg').in('id', ids))
      ;(g ?? []).forEach((r) => (grnById[r.id] = r))
    }
    addSheet(
      'Pricing',
      [
        { header: 'Date', width: 12 },
        { header: 'Vehicle', width: 14 },
        { header: 'Supplier', width: 18 },
        { header: 'Net (kg)', width: 12, numFmt: KG },
        { header: 'Rate / kg', width: 11, numFmt: MONEY },
        { header: 'Amount', width: 14, numFmt: MONEY },
        { header: 'Entered by', width: 16 },
      ],
      (pricing ?? []).filter((p) => {
        const date = grnById[p.grn_id]?.entry_date
        return date && (!range.from || date >= range.from) && (!range.to || date <= range.to)
      }).map((p) => {
        const g = grnById[p.grn_id]
        return [g?.entry_date ?? null, g?.vehicle_no ?? null, g?.supplier ?? null, g?.net_kg ?? null, p.rate_per_kg, p.amount, nameOf(p.entered_by)]
      }),
      'visible to managers only',
    )
  }

  // ---- download ----
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const span = range.from || range.to ? `_${range.from ?? 'start'}_to_${range.to ?? 'today'}` : ''
  a.download = `bristol_production_ledger${span}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
