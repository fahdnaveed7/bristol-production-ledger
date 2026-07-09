import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useOpenShift } from '../lib/hooks'
import { addOutput, createBatch, subscribeShiftBatches } from '../lib/batch'
import type { Batch, BatchOutput, Product } from '../lib/types'
import { PRODUCTS, PRODUCT_LABEL } from '../lib/types'
import { outputKg, yieldPct } from '../lib/yield'
import { kg, pct } from '../lib/format'
import { EmptyState, Notice, PageHeader, Stat } from '../components/ui'
import { supabase } from '../lib/supabase'
import type { Grn } from '../lib/types'

export function Production() {
  const { profile } = useAuth()
  const { shift } = useOpenShift()
  const [batches, setBatches] = useState<Batch[]>([])
  const [outputs, setOutputs] = useState<BatchOutput[]>([])
  const [receivedKg, setReceivedKg] = useState(0)

  useEffect(() => {
    if (!shift) return
    return subscribeShiftBatches(shift.id, (b, o) => {
      setBatches(b)
      setOutputs(o)
    })
  }, [shift])

  // Received this shift (for the live silo balance).
  useEffect(() => {
    if (!shift) return
    const load = async () => {
      const { data } = await supabase.from('grn').select('net_kg').eq('shift_id', shift.id).eq('status', 'received')
      setReceivedKg(((data as Pick<Grn, 'net_kg'>[]) ?? []).reduce((s, g) => s + (g.net_kg ?? 0), 0))
    }
    void load()
    const ch = supabase
      .channel(`prod-grn-${shift.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grn' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [shift])

  const fedKg = useMemo(() => batches.reduce((s, b) => s + (b.raw_fed_kg ?? 0), 0), [batches])
  const silo = (shift?.opening_balance_kg ?? 0) + receivedKg - fedKg

  const [bf, setBf] = useState({ batch_no: '', raw_fed_kg: '', species_note: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submitBatch() {
    setMsg(null)
    if (!shift) return
    if (!bf.batch_no.trim()) return setMsg('Batch no is required')
    const fed = Number(bf.raw_fed_kg)
    if (!fed || fed <= 0) return setMsg('Enter raw material fed (kg)')
    setBusy(true)
    try {
      const { queued } = await createBatch({
        batch_no: bf.batch_no,
        shift_id: shift.id,
        raw_fed_kg: fed,
        species_note: bf.species_note,
        operator_id: profile!.id,
      })
      setBf({ batch_no: '', raw_fed_kg: '', species_note: '' })
      setMsg(queued ? 'Saved offline — will sync' : 'Batch started')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!shift) {
    return (
      <>
        <PageHeader title="Production" subtitle="Batches & output" />
        <Notice tone="warn">
          No shift is open. <Link className="underline font-semibold" to="/shift">Open a shift</Link> to start feeding raw material.
        </Notice>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Production" subtitle={`${shift.label} shift · ${shift.business_date}`} />

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Opening" value={kg(shift.opening_balance_kg)} hint="kg" />
        <Stat label="Received" value={kg(receivedKg)} hint="kg this shift" />
        <Stat label="Silo balance" value={kg(silo)} hint={`fed ${kg(fedKg)} kg`} accent />
      </div>

      {msg && (
        <div className="mb-4">
          <Notice tone={msg.includes('offline') ? 'warn' : 'success'}>{msg}</Notice>
        </div>
      )}

      <div className="card p-4 mb-6">
        <h2 className="font-semibold text-gray-900 mb-3">New batch — feed raw material</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Batch no</label>
            <input className="field" value={bf.batch_no} onChange={(e) => setBf((s) => ({ ...s, batch_no: e.target.value }))} />
          </div>
          <div>
            <label className="label">Raw fed (kg)</label>
            <input className="field num text-lg" value={bf.raw_fed_kg} onChange={(e) => setBf((s) => ({ ...s, raw_fed_kg: e.target.value }))} inputMode="decimal" />
          </div>
          <div className="col-span-2">
            <label className="label">Species note (optional)</label>
            <input className="field" value={bf.species_note} onChange={(e) => setBf((s) => ({ ...s, species_note: e.target.value }))} />
          </div>
        </div>
        <button className="btn-primary w-full mt-4" onClick={submitBatch} disabled={busy}>
          {busy ? 'Saving…' : 'Start batch'}
        </button>
      </div>

      <h2 className="font-semibold text-gray-900 mb-2">Batches this shift ({batches.length})</h2>
      {batches.length === 0 ? (
        <EmptyState>No batches yet this shift.</EmptyState>
      ) : (
        <div className="space-y-3">
          {batches.map((b) => (
            <BatchCard key={b.id} batch={b} outputs={outputs.filter((o) => o.batch_id === b.id)} />
          ))}
        </div>
      )}
    </>
  )
}

function BatchCard({ batch, outputs }: { batch: Batch; outputs: BatchOutput[] }) {
  const [open, setOpen] = useState(false)
  const [product, setProduct] = useState<Product>('fishmeal')
  const [mode, setMode] = useState<'bags' | 'kg'>('bags')
  const [bags, setBags] = useState('')
  const [perBag, setPerBag] = useState('50')
  const [totalKg, setTotalKg] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const byProduct = (p: Product) => outputs.filter((o) => o.product === p).reduce((s, o) => s + outputKg(o), 0)

  async function add() {
    setErr(null)
    try {
      if (mode === 'bags') {
        const nb = Number(bags)
        const pb = Number(perBag)
        if (!nb || nb <= 0) return setErr('Enter number of bags')
        if (!pb || pb <= 0) return setErr('Enter kg per bag')
        setBusy(true)
        await addOutput({ batch_id: batch.id, product, bags: nb, kg_per_bag: pb, total_kg: nb * pb })
      } else {
        const tk = Number(totalKg)
        if (!tk || tk <= 0) return setErr('Enter kg')
        setBusy(true)
        await addOutput({ batch_id: batch.id, product, bags: null, kg_per_bag: null, total_kg: tk })
      }
      setBags('')
      setTotalKg('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-gray-900">Batch {batch.batch_no}</div>
          <div className="text-xs text-gray-500 num">
            Fed {kg(batch.raw_fed_kg)} kg{batch.species_note ? ` · ${batch.species_note}` : ''}
          </div>
        </div>
        <button className="text-sm text-teal font-semibold" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Add output'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3 text-sm num">
        {PRODUCTS.map((p) => {
          const k = byProduct(p)
          return (
            <div key={p} className="rounded-md bg-gray-50 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">{PRODUCT_LABEL[p].split(' ')[0]}</div>
              <div className="font-semibold">{kg(k)} kg</div>
              <div className="text-[11px] text-gray-400">{pct(yieldPct(k, batch.raw_fed_kg))}</div>
            </div>
          )
        })}
      </div>

      {open && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="label">Product</label>
              <select className="field" value={product} onChange={(e) => setProduct(e.target.value as Product)}>
                {PRODUCTS.map((p) => (
                  <option key={p} value={p}>
                    {PRODUCT_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Measure</label>
              <select className="field" value={mode} onChange={(e) => setMode(e.target.value as 'bags' | 'kg')}>
                <option value="bags">Bags</option>
                <option value="kg">Direct kg</option>
              </select>
            </div>
          </div>

          {mode === 'bags' ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Bags</label>
                <input className="field num" value={bags} onChange={(e) => setBags(e.target.value)} inputMode="numeric" />
              </div>
              <div>
                <label className="label">kg / bag</label>
                <select className="field num" value={perBag} onChange={(e) => setPerBag(e.target.value)}>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label className="label">Total kg</label>
              <input className="field num" value={totalKg} onChange={(e) => setTotalKg(e.target.value)} inputMode="decimal" />
            </div>
          )}

          <button className="btn-primary w-full mt-3" onClick={add} disabled={busy}>
            {busy ? 'Saving…' : `Add ${PRODUCT_LABEL[product].split(' ')[0]} output`}
          </button>
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
        </div>
      )}
    </div>
  )
}
