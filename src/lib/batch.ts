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
  })
}

export function subscribeShiftBatches(
  shiftId: string,
  onChange: (batches: Batch[], outputs: BatchOutput[]) => void,
) {
  const load = async () => {
    const { data: batches } = await supabase
      .from('batch')
      .select('*')
      .eq('shift_id', shiftId)
      .order('started_at', { ascending: false })
    const ids = (batches as Batch[] | null ?? []).map((b) => b.id)
    let outputs: BatchOutput[] = []
    if (ids.length) {
      const { data: out } = await supabase.from('batch_output').select('*').in('batch_id', ids)
      outputs = (out as BatchOutput[] | null) ?? []
    }
    onChange((batches as Batch[]) ?? [], outputs)
  }
  void load()
  const ch = supabase
    .channel(`batches-${shiftId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'batch' }, () => void load())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'batch_output' }, () => void load())
    .subscribe()
  return () => {
    void supabase.removeChannel(ch)
  }
}
