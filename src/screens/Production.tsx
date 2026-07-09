import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useOpenShift } from '../lib/hooks'
import { addOutput, createBatch, subscribeShiftBatches } from '../lib/batch'
import type { Batch, BatchOutput, Product } from '../lib/types'
import { ACTIVE_PRODUCTS, PRODUCT_LABEL } from '../lib/types'
import { outputKg, yieldPct } from '../lib/yield'
import { kg, pct, timeStr } from '../lib/format'
import { EmptyState, PageHeader } from '../components/ui'
import { ShiftBanner } from '../components/ShiftBanner'

export function Production() {
  const { profile, role } = useAuth()
  const { shift, reload } = useOpenShift()
  const [batches, setBatches] = useState<Batch[]>([])
  const [outputs, setOutputs] = useState<BatchOutput[]>([])

  useEffect(() => {
    if (!shift) {
      setBatches([])
      setOutputs([])
      return
    }
    return subscribeShiftBatches(shift.id, (b, o) => {
      setBatches(b)
      setOutputs(o)
    })
  }, [shift])

  const canControl = role === 'production' || role === 'manager'

  return (
    <>
      <PageHeader title="Production" subtitle="Feed fish in, record bags out" />

      <ShiftBanner shift={shift} reload={reload} canControl={canControl} />

      {shift && (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            <FeedForm shiftId={shift.id} profileId={profile!.id} nextNo={batches.length + 1} />
            <OutputForm latestBatch={batches[0] ?? null} />
          </div>

          <ShiftLog batches={batches} outputs={outputs} />
        </>
      )}
    </>
  )
}

function FeedForm({ shiftId, profileId, nextNo }: { shiftId: string; profileId: string; nextNo: number }) {
  const [fed, setFed] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function submit() {
    setMsg(null)
    const n = Number(fed)
    if (!n || n <= 0) return setMsg('How many kg went into the plant?')
    setBusy(true)
    try {
      const { queued } = await createBatch({
        batch_no: `B-${nextNo}`, // numbered automatically
        shift_id: shiftId,
        raw_fed_kg: n,
        species_note: note,
        operator_id: profileId,
      })
      setFed('')
      setNote('')
      setMsg(queued ? 'Saved on this device — will send when internet is back' : null)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-bold text-gray-900 mb-1">⬇ Fish into the plant</h2>
      <p className="text-xs text-gray-500 mb-3">Each entry is numbered automatically (next: B-{nextNo})</p>
      <label className="label">Kg fed</label>
      <input className="field num text-xl mb-2" value={fed} onChange={(e) => setFed(e.target.value)} inputMode="decimal" placeholder="15000" />
      <label className="label">Fish type (optional)</label>
      <input className="field mb-3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sardine" />
      <button className="btn-primary w-full" onClick={submit} disabled={busy}>
        {busy ? 'Saving…' : 'Record feed'}
      </button>
      {msg && <p className="text-xs text-amber-700 mt-2">{msg}</p>}
    </div>
  )
}

function OutputForm({ latestBatch }: { latestBatch: Batch | null }) {
  const [product, setProduct] = useState<Product>('fishmeal')
  const [mode, setMode] = useState<'bags' | 'kg'>('bags')
  const [bags, setBags] = useState('')
  const [perBag, setPerBag] = useState('50')
  const [totalKg, setTotalKg] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const liveKg = mode === 'bags' ? (Number(bags) || 0) * (Number(perBag) || 0) : Number(totalKg) || 0

  async function submit() {
    setMsg(null)
    if (!latestBatch) return
    if (liveKg <= 0) return setMsg(mode === 'bags' ? 'How many bags?' : 'How many kg?')
    setBusy(true)
    try {
      const { queued } = await addOutput({
        batch_id: latestBatch.id, // product comes out of the most recent feed
        product,
        bags: mode === 'bags' ? Number(bags) : null,
        kg_per_bag: mode === 'bags' ? Number(perBag) : null,
        total_kg: liveKg,
      })
      setBags('')
      setTotalKg('')
      setMsg(queued ? 'Saved on this device — will send when internet is back' : null)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-bold text-gray-900 mb-1">⬆ Product out</h2>
      <p className="text-xs text-gray-500 mb-3">
        {latestBatch ? `Counts against feed ${latestBatch.batch_no}` : 'Record a feed first — then log what comes out'}
      </p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="label">Product</label>
          <select className="field py-2" value={product} onChange={(e) => setProduct(e.target.value as Product)}>
            {ACTIVE_PRODUCTS.map((p) => (
              <option key={p} value={p}>
                {PRODUCT_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Counted as</label>
          <select className="field py-2" value={mode} onChange={(e) => setMode(e.target.value as 'bags' | 'kg')}>
            <option value="bags">Bags</option>
            <option value="kg">Kg</option>
          </select>
        </div>
      </div>
      {mode === 'bags' ? (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className="label">Bags</label>
            <input className="field num py-2" value={bags} onChange={(e) => setBags(e.target.value)} inputMode="numeric" placeholder="60" />
          </div>
          <div>
            <label className="label">Kg per bag</label>
            <select className="field num py-2" value={perBag} onChange={(e) => setPerBag(e.target.value)}>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="mb-2">
          <label className="label">Total kg</label>
          <input className="field num py-2" value={totalKg} onChange={(e) => setTotalKg(e.target.value)} inputMode="decimal" />
        </div>
      )}
      {liveKg > 0 && (
        <p className="text-sm text-gray-700 mb-2">
          = <span className="num font-bold text-navy">{kg(liveKg)} kg</span> {PRODUCT_LABEL[product].split(' ')[0].toLowerCase()}
        </p>
      )}
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !latestBatch}>
        {busy ? 'Saving…' : 'Record output'}
      </button>
      {msg && <p className="text-xs text-amber-700 mt-2">{msg}</p>}
    </div>
  )
}

function ShiftLog({ batches, outputs }: { batches: Batch[]; outputs: BatchOutput[] }) {
  const fedTotal = batches.reduce((s, b) => s + (b.raw_fed_kg ?? 0), 0)
  const productTotal = (p: Product) => outputs.filter((o) => o.product === p).reduce((s, o) => s + outputKg(o), 0)
  const chrono = [...batches].reverse() // oldest first, like a paper log

  return (
    <div className="card p-4 mt-4">
      <h2 className="font-bold text-gray-900 mb-3">This shift's log</h2>
      {chrono.length === 0 ? (
        <EmptyState>Nothing fed yet this shift.</EmptyState>
      ) : (
        <div className="space-y-3">
          {chrono.map((b) => {
            const outs = outputs.filter((o) => o.batch_id === b.id)
            return (
              <div key={b.id} className="border-l-2 border-navy-light pl-3">
                <div className="text-sm">
                  <span className="font-semibold text-gray-900">{b.batch_no}</span>{' '}
                  <span className="text-gray-500">· {timeStr(b.started_at)} ·</span>{' '}
                  <span className="num font-semibold">⬇ {kg(b.raw_fed_kg)} kg in</span>
                  {b.species_note && <span className="text-gray-500"> · {b.species_note}</span>}
                </div>
                {outs.map((o) => (
                  <div key={o.id} className="text-sm text-gray-600 num">
                    ⬆ {o.bags ? `${o.bags} bags × ${o.kg_per_bag} = ` : ''}
                    {kg(outputKg(o))} kg {o.product === 'fishmeal' ? 'fishmeal' : 'fish oil'}
                  </div>
                ))}
              </div>
            )
          })}

          <div className="border-t border-gray-200 pt-3 grid grid-cols-3 gap-2 text-sm num">
            <div>
              <div className="label">Fed total</div>
              <div className="font-bold">{kg(fedTotal)} kg</div>
            </div>
            {ACTIVE_PRODUCTS.map((p) => (
              <div key={p}>
                <div className="label">{PRODUCT_LABEL[p].split(' ')[0]}</div>
                <div className="font-bold">
                  {kg(productTotal(p))} kg{' '}
                  <span className="text-gray-400 font-normal">{pct(yieldPct(productTotal(p), fedTotal))}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
