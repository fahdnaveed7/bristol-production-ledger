import { supabase } from '../lib/supabase'
import { uuid } from '../lib/format'
import { db, type PendingMutation } from './db'

type Listener = (pending: number) => void
const listeners = new Set<Listener>()
export const CAPTURE_CHANGED = 'ledger-capture-changed'

export function onQueueChange(fn: Listener): () => void {
  listeners.add(fn)
  void notify()
  return () => { listeners.delete(fn) }
}
async function notify() {
  const n = await db.mutations.count()
  listeners.forEach((l) => l(n))
  window.dispatchEvent(new Event(CAPTURE_CHANGED))
}
export function isNetworkError(err: unknown): boolean {
  if (!navigator.onLine) return true
  const msg = (err as { message?: string })?.message?.toLowerCase() ?? ''
  return /fetch|network|timeout|load failed|connection/.test(msg)
}
async function apply(m: Pick<PendingMutation, 'table' | 'op' | 'payload'>) {
  // Generated columns are read-only, even when a cached row is passed by mistake.
  const { net_kg: _net, avg_box_kg: _avg, sampled_estimate_kg: _estimate, ...payload } = m.payload
  if (m.op === 'insert') return supabase.from(m.table).upsert(payload, { onConflict: 'id' })
  const { id, ...rest } = payload
  return supabase.from(m.table).update(rest).eq('id', id).select('id').single()
}

// Persist before sending. One ordered drain prevents an online update overtaking
// its queued parent insert, and prevents duplicate concurrent replays.
export async function queuedWrite(
  table: PendingMutation['table'], op: PendingMutation['op'],
  payload: Record<string, unknown> & { id: string },
): Promise<{ queued: boolean }> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('Can you sign in before recording?')
  const id = uuid()
  await db.mutations.add({ id, table, op, rowId: payload.id, payload,
    userId: data.session.user.id, createdAt: Date.now() })
  await notify()
  const errors = await flushQueue()
  if (errors.has(id)) throw new Error(errors.get(id))
  return { queued: !!(await db.mutations.get(id)) }
}
let draining: Promise<Map<string, string>> | null = null
export function flushQueue(): Promise<Map<string, string>> {
  if (draining) return draining
  draining = drain().finally(() => { draining = null })
  return draining
}
async function drain(): Promise<Map<string, string>> {
  const errors = new Map<string, string>()
  if (!navigator.onLine) return errors
  const { data } = await supabase.auth.getSession()
  if (!data.session) return errors
  const userId = data.session.user.id
  const pending = await db.mutations.orderBy('createdAt').toArray()
  for (const m of pending) {
    // Shared phones must never replay another person's saved writes under this login.
    if (m.userId && m.userId !== userId) continue
    try {
      const { error } = await apply(m)
      if (error) throw error
    } catch (error) {
      if (isNetworkError(error)) break
      const message = (error as Error).message || 'A saved record could not be sent.'
      errors.set(m.id, message)
      window.dispatchEvent(new CustomEvent('ledger-sync-error', { detail: message }))
    }
    await db.mutations.delete(m.id)
    await notify()
  }
  return errors
}
export function startQueueSync() {
  const sync = () => { void flushQueue().catch((error) => {
    window.dispatchEvent(new CustomEvent('ledger-sync-error', { detail: (error as Error).message }))
  }) }
  window.addEventListener('online', sync)
  window.setInterval(sync, 20_000)
  supabase.auth.onAuthStateChange(() => { window.setTimeout(sync, 0) })
  sync()
}
