import { supabase } from '../lib/supabase'
import { db, type PendingMutation } from './db'
import { isNetworkError } from './queue'

// Cached reads are partitioned by the signed-in user. They are available after an
// offline reload; pending writes overlay them so recording can continue locally.
export async function cachedRows<T>(key: string, query: PromiseLike<{ data: T[] | null; error?: { message: string } | null }>, table?: PendingMutation['table'], requireFresh = false): Promise<T[]> {
  const { data: auth } = await supabase.auth.getSession()
  const userId = auth.session?.user.id
  if (!userId) return []
  const cacheKey = `${userId}:${key}`
  let rows: T[]
  const request = Promise.resolve(query).catch((error) => ({ data: null, error }))
  const { data, error } = navigator.onLine ? await request : { data: null, error: { message: 'Network offline' } }
  if (error) {
    if (requireFresh || !isNetworkError(error)) throw error
    rows = (await db.cache.get(cacheKey))?.rows as T[] ?? []
  } else {
    rows = data ?? []
    await db.cache.put({ key: cacheKey, rows })
  }
  if (!table) return rows
  const map = new Map(rows.map((r) => [(r as { id: string }).id, r]))
  const pending = await db.mutations.orderBy('createdAt').toArray()
  for (const m of pending) {
    if (m.table !== table || (m.userId && m.userId !== userId)) continue
    const row = { ...(map.get(m.rowId) ?? {}), ...m.payload } as Record<string, unknown>
    if (table === 'grn') {
      row.net_kg = Number(row.gross_kg ?? 0) - Number(row.tare_kg ?? 0)
      row.avg_box_kg = Number(row.sample_boxes) > 0 ? Number(row.sample_weight_kg) / Number(row.sample_boxes) : null
      row.sampled_estimate_kg = row.avg_box_kg == null ? null : Number(row.avg_box_kg) * Number(row.total_boxes)
    }
    map.set(m.rowId, row as T)
  }
  return [...map.values()]
}
