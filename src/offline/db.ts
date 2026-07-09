import Dexie, { type Table } from 'dexie'

// One pending write to Supabase, captured while offline (or on transient failure).
// Keyed by a client uuid so replay is idempotent (insert/update use upsert on the row id).
export interface PendingMutation {
  id: string // client uuid — the queue key
  table: 'grn' | 'batch' | 'batch_output'
  op: 'insert' | 'update'
  rowId: string // primary key of the affected row
  payload: Record<string, unknown>
  createdAt: number
}

class LedgerDB extends Dexie {
  mutations!: Table<PendingMutation, string>
  constructor() {
    super('bristol-ledger')
    this.version(1).stores({
      mutations: 'id, table, rowId, createdAt',
    })
  }
}

export const db = new LedgerDB()
