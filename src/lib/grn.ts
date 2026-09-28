import { readAll } from './read'
import { cachedRows } from '../offline/cache'
import { CAPTURE_CHANGED } from '../offline/queue'
import { supabase } from './supabase'
import { queuedWrite } from '../offline/queue'
import { uuid } from './format'
import type { Grn } from './types'

// Soft-warn helper: has this register no already been typed today?
export async function registerNoSeenToday(registerNo: string, entryDate: string): Promise<boolean> {
  const v = registerNo.trim()
  if (!v) return false
  const { data } = await supabase
    .from('grn')
    .select('id')
    .eq('entry_date', entryDate)
    .eq('register_no', v)
    .limit(1)
  return (data?.length ?? 0) > 0
}

export interface GrossInput {
  register_no: string
  vehicle_no: string
  supplier: string
  driver_name: string
  species: string
  gross_kg: number
  shift_id: string
  weighbridge_by: string
  entry_date: string
  remarks?: string
}

export async function createGrnGross(input: GrossInput): Promise<{ id: string; queued: boolean }> {
  const id = uuid()
  const payload = {
    id,
    register_no: input.register_no.trim() || null,
    vehicle_no: input.vehicle_no.trim(),
    supplier: input.supplier.trim() || null,
    driver_name: input.driver_name.trim() || null,
    species: input.species.trim() || null,
    gross_kg: input.gross_kg,
    shift_id: input.shift_id,
    weighbridge_by: input.weighbridge_by,
    entry_date: input.entry_date,
    status: 'weighed_gross',
    arrived_at: new Date().toISOString(),
    remarks: input.remarks?.trim() || null,
  }
  const { queued } = await queuedWrite('grn', 'insert', payload)
  return { id, queued }
}

export async function saveSampling(
  grnId: string,
  vals: { total_boxes: number; sample_boxes: number; sample_weight_kg: number; receiving_by: string },
): Promise<{ queued: boolean }> {
  return queuedWrite('grn', 'update', {
    id: grnId,
    total_boxes: vals.total_boxes,
    sample_boxes: vals.sample_boxes,
    sample_weight_kg: vals.sample_weight_kg,
    receiving_by: vals.receiving_by,
    status: 'sampling',
  })
}

export async function saveTare(grnId: string, tare_kg: number): Promise<{ queued: boolean }> {
  return queuedWrite('grn', 'update', { id: grnId, tare_kg, status: 'weighed_tare' })
}

export async function markReceived(grnId: string): Promise<{ queued: boolean }> {
  return queuedWrite('grn', 'update', {
    id: grnId,
    status: 'received',
    received_at: new Date().toISOString(),
  })
}

export async function rejectGrn(grnId: string, remarks: string): Promise<{ queued: boolean }> {
  return queuedWrite('grn', 'update', { id: grnId, status: 'rejected', remarks: remarks.trim() || null })
}

export function subscribeGrn(onChange: (rows: Grn[]) => void) {
  const load = async () => {
    const data = await cachedRows<Grn>('grn', readAll(supabase
      .from('grn')
      .select('*')
      .order('arrived_at', { ascending: false })
      ), 'grn')
    onChange((data as Grn[]) ?? [])
  }
  const reload = () => { void load().catch(() => {}) }
  reload()
  window.addEventListener(CAPTURE_CHANGED, reload)
  const ch = supabase
    .channel('grn-feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'grn' }, reload)
    .subscribe()
  return () => {
    window.removeEventListener(CAPTURE_CHANGED, reload)
    void supabase.removeChannel(ch)
  }
}
