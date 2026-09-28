import { readAll } from './read'
import { cachedRows } from '../offline/cache'
import { CAPTURE_CHANGED } from '../offline/queue'
import { supabase } from './supabase'
import { queuedWrite } from '../offline/queue'
import { uuid } from './format'
import type { Batch, BatchOutput, Product } from './types'

export async function createBatch(input: {
  batch_no: string
  shift_id: string
  raw_fed_kg: number
  species_note: string
  operator_id: string
}): Promise<{ id: string; queued: boolean }> {
  const id = uuid()
  const { queued } = await queuedWrite('batch', 'insert', {
    id,
    batch_no: input.batch_no.trim(),
    shift_id: input.shift_id,
    raw_fed_kg: input.raw_fed_kg,
    species_note: input.species_note.trim() || null,
    operator_id: input.operator_id,
    started_at: new Date().toISOString(),
  })
  return { id, queued }
}

export async function addOutput(input: {
  batch_id: string
  product: Product
  bags: number | null
  kg_per_bag: number | null
  total_kg: number | null
}): Promise<{ queued: boolean }> {
  const id = uuid()
  return queuedWrite('batch_output', 'insert', {
    id,
    batch_id: input.batch_id,
    product: input.product,
    bags: input.bags,
    kg_per_bag: input.kg_per_bag,
    total_kg: input.total_kg,
    created_at: new Date().toISOString(),
  })
}

export function subscribeShiftBatches(
  shiftId: string,
  onChange: (batches: Batch[], outputs: BatchOutput[]) => void,
) {
  const load = async () => {
    const allBatches = await cachedRows<Batch>(`batch-${shiftId}`, readAll(supabase.from('batch').select('*').eq('shift_id', shiftId).order('started_at', { ascending: false })), 'batch')
    const batches = allBatches.filter((b) => b.shift_id === shiftId).sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))
    const ids = batches.map((b) => b.id)
    const outputs = ids.length ? await cachedRows<BatchOutput>(`outputs-${shiftId}`, readAll(supabase.from('batch_output').select('*').in('batch_id', ids).order('id')), 'batch_output') : []
    onChange(batches, outputs.filter((o) => ids.includes(o.batch_id)))
  }
  const reload = () => { void load().catch(() => {}) }
  reload()
  window.addEventListener(CAPTURE_CHANGED, reload)
  const ch = supabase
    .channel(`batches-${shiftId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'batch' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'batch_output' }, reload)
    .subscribe()
  return () => {
    window.removeEventListener(CAPTURE_CHANGED, reload)
    void supabase.removeChannel(ch)
  }
}
