import 'fake-indexeddb/auto'
import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ online: false, user: 'person-a', apply: vi.fn() }))
vi.stubGlobal('navigator', { get onLine() { return mock.online } })
vi.stubGlobal('window', new EventTarget())
vi.mock('../src/lib/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: mock.user } } } }) },
  from: (table: string) => ({
    upsert: (payload: unknown) => mock.apply(table, 'insert', payload),
    update: (payload: unknown) => ({ eq: (_key: string, id: string) => ({ select: () => ({ single: () => mock.apply(table, 'update', { id, ...payload as object }) }) }) }),
  }),
} }))
import { db } from '../src/offline/db'
import { queuedWrite, flushQueue } from '../src/offline/queue'
import { cachedRows } from '../src/offline/cache'
beforeEach(async () => {
  await db.mutations.clear(); await db.cache.clear()
  mock.online = false; mock.user = 'person-a'; mock.apply.mockReset().mockResolvedValue({ error: null })
})
it('persists offline once, overlays generated values, then drains parent before update', async () => {
  await queuedWrite('grn', 'insert', { id: 'truck', gross_kg: 24860 })
  await queuedWrite('grn', 'update', { id: 'truck', tare_kg: 8940, total_boxes: 800, sample_boxes: 30, sample_weight_kg: 600 })
  const rows = await cachedRows<any>('trucks', Promise.resolve({ data: [], error: null }), 'grn')
  expect(rows[0].net_kg).toBe(15920)
  expect(rows[0].sampled_estimate_kg).toBe(16000)
  mock.online = true
  await Promise.all([flushQueue(), flushQueue()])
  expect(mock.apply.mock.calls.map((c) => c[1])).toEqual(['insert', 'update'])
  expect(await db.mutations.count()).toBe(0)
  await flushQueue()
  expect(mock.apply).toHaveBeenCalledTimes(2)
})
it('does not replay a different staff member’s queue', async () => {
  await queuedWrite('batch', 'insert', { id: 'feed' })
  mock.user = 'person-b'; mock.online = true
  await flushQueue()
  expect(mock.apply).not.toHaveBeenCalled()
  expect(await db.mutations.count()).toBe(1)
})
it('keeps network failures, drops permission errors, strips generated columns', async () => {
  mock.online = true
  mock.apply.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  expect(await queuedWrite('grn', 'insert', { id: 'truck', net_kg: 7 })).toEqual({ queued: true })
  expect(mock.apply.mock.calls[0][2]).not.toHaveProperty('net_kg')
  mock.apply.mockResolvedValueOnce({ error: { message: 'Permission denied' } })
  await flushQueue()
  expect(await db.mutations.count()).toBe(0)
})
it('keeps cached offline reads partitioned by user and refuses stale close snapshots', async () => {
  mock.online = true
  await cachedRows('rows', Promise.resolve({ data: [{ id: 'x' }], error: null }))
  mock.online = false
  expect(await cachedRows('rows', Promise.resolve({ data: null, error: null }))).toEqual([{ id: 'x' }])
  await expect(cachedRows('rows', Promise.resolve({ data: null, error: null }), undefined, true)).rejects.toMatchObject({ message: 'Network offline' })
  mock.user = 'person-b'
  expect(await cachedRows('rows', Promise.resolve({ data: null, error: null }))).toEqual([])
})
