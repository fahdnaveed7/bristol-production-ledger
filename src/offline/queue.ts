import { supabase } from '../lib/supabase'
import { uuid } from '../lib/format'
import { db, type PendingMutation } from './db'

type Listener = (pending: number) => void
const listeners = new Set<Listener>()

export function onQueueChange(fn: Listener): () => void {
  listeners.add(fn)
  void notify()
  return () => listeners.delete(fn)
}

async function notify() {
  const n = await db.mutations.count()
  listeners.forEach((l) => l(n))
}

function isNetworkError(err: unknown): boolean {
  if (!navigator.onLine) return true
  const msg = (err as { message?: string })?.message?.toLowerCase() ?? ''
  return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('timeout')
}

async function apply(m: Pick<PendingMutation, 'table' | 'op' | 'payload'>) {
  if (m.op === 'insert') {
    // upsert (not insert) so a replayed insert never duplicates the row.
    return supabase.from(m.table).upsert(m.payload as never, { onConflict: 'id' })
  }
  const { id, ...rest } = m.payload as { id: string } & Record<string, unknown>
  return supabase.from(m.table).update(rest as never).eq('id', id)
}

// Try to write live; on a network failure, queue it and report success optimistically.
// Returns { queued: true } when the write went to the offline queue.
export async function queuedWrite(
  table: PendingMutation['table'],
  op: PendingMutation['op'],
  payload: Record<string, unknown> & { id: string },
): Promise<{ queued: boolean }> {
  if (navigator.onLine) {
    const { error } = await apply({ table, op, payload })
    if (!error) return { queued: false }
    if (!isNetworkError(error)) throw error
  }
  const m: PendingMutation = {
    id: uuid(),
    table,
    op,
    rowId: payload.id,
    payload,
    createdAt: Date.now(),
  }
  await db.mutations.add(m)
  await notify()
  return { queued: true }
}

let flushing = false

export async function flushQueue(): Promise<void> {
  if (flushing || !navigator.onLine) return
  flushing = true
  try {
    const pending = await db.mutations.orderBy('createdAt').toArray()
    for (const m of pending) {
      const { error } = await apply(m)
      if (error) {
        if (isNetworkError(error)) break // stay queued, retry later
        // Non-network error (e.g. RLS/validation): drop it so the queue can't wedge.
        // eslint-disable-next-line no-console
        console.error('Dropping unrecoverable queued mutation', m, error)
      }
      await db.mutations.delete(m.id)
      await notify()
    }
  } finally {
    flushing = false
  }
}

export function startQueueSync() {
  window.addEventListener('online', () => void flushQueue())
  // Periodic safety net in case an 'online' event is missed.
  window.setInterval(() => void flushQueue(), 20_000)
  void flushQueue()
}
