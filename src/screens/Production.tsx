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
      <PageHeader title="Production" subtitle="Feed the plant, then record fishmeal and oil as they come out" />

      <ShiftBanner shift={shift} reload={reload} canControl={canControl} />

      {shift && (
        <>
          <FeedForm shiftId={shift.id} profileId={profile!.id} nextNo={batches.length + 1} />

          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <MealOutForm latestBatch={batches[0] ?? null} />
            <OilOutForm latestBatch={batches[0] ?? null} />
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
    if (!Number.isFinite(n) || n <= 0) return setMsg('How many kg went into the plant?')
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
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-bold text-gray-900 mb-1">⬇ Fish into the plant</h2>
      <p className="text-xs text-gray-500 mb-3">From the infeed area. Each feed is numbered automatically (next: B-{nextNo})</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Kg fed</label>
          <input aria-label="Kg fed" className="field num text-xl" value={fed} onChange={(e) => setFed(e.target.value)} inputMode="decimal" placeholder="15000" />
        </div>
        <div>
          <label className="label">Fish type (optional)</label>
          <input aria-label="Fish type (optional)" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sardine" />
        </div>
      </div>
      <button className="btn-primary w-full mt-3" onClick={submit} disabled={busy}>
        {busy ? 'Saving…' : 'Record feed'}
      </button>
      {msg && <p className="text-xs text-amber-700 mt-2">{msg}</p>}
    </div>
  )
}

// Shared submit plumbing for the two output cards.
function useOutputSubmit(latestBatch: Batch | null, product: Product) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function submit(vals: { bags: number | null; kg_per_bag: number | null; total_kg: number }) {
    setMsg(null)
    if (!latestBatch) return false
    setBusy(true)
    try {
      const { queued } = await addOutput({
        batch_id: latestBatch.id, // product counts against the most recent feed
        product,
        bags: vals.bags,
        kg_per_bag: vals.kg_per_bag,
        total_kg: vals.total_kg,
      })
      setMsg(queued ? 'Saved on this device — will send when internet is back' : 'Added to stock ✓')
      return true
    } catch (e) {
      setMsg((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, msg, setMsg, submit }
}

function MealOutForm({ latestBatch }: { latestBatch: Batch | null }) {
  const [mode, setMode] = useState<'bags' | 'kg'>('bags')
  const [bags, setBags] = useState('')
  const [perBag, setPerBag] = useState('50')
  const [totalKg, setTotalKg] = useState('')
  const { busy, msg, setMsg, submit } = useOutputSubmit(latestBatch, 'fishmeal')

  const liveKg = mode === 'bags' ? (Number(bags) || 0) * (Number(perBag) || 0) : Number(totalKg) || 0

  async function onSave() {
    if (mode === 'bags' && !Number.isInteger(Number(bags))) return setMsg('How many whole bags?')
    if (!Number.isFinite(liveKg) || liveKg <= 0) return setMsg(mode === 'bags' ? 'How many bags?' : 'How many kg?')
    const saved = await submit({
      bags: mode === 'bags' ? Number(bags) : null,
      kg_per_bag: mode === 'bags' ? Number(perBag) : null,
      total_kg: liveKg,
    })
    if (saved) { setBags(''); setTotalKg('') }
  }

  return (
    <div className="card p-4">
      <h2 className="font-bold text-gray-900 mb-1">⬆ Fishmeal out</h2>
      <p className="text-xs text-gray-500 mb-3">Bags go straight into the stock register</p>
      {mode === 'bags' ? (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className="label">Bags</label>
            <input aria-label="Bags" className="field num py-2" value={bags} onChange={(e) => setBags(e.target.value)} inputMode="numeric" placeholder="60" />
          </div>
          <div>
            <label className="label">Kg per bag</label>
            <select aria-label="Kg per bag" className="field num py-2" value={perBag} onChange={(e) => setPerBag(e.target.value)}>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="mb-2">
          <label className="label">Total kg</label>
          <input aria-label="Total kg" className="field num py-2" value={totalKg} onChange={(e) => setTotalKg(e.target.value)} inputMode="decimal" />
        </div>
      )}
      <button className="text-xs text-gray-400 underline mb-2" onClick={() => setMode(mode === 'bags' ? 'kg' : 'bags')}>
        {mode === 'bags' ? 'Count in kg instead' : 'Count in bags instead'}
      </button>
      {liveKg > 0 && (
        <p className="text-sm text-gray-700 mb-2">
          = <span className="num font-bold text-navy">{kg(liveKg)} kg</span> fishmeal
        </p>
      )}
      <button className="btn-primary w-full" onClick={onSave} disabled={busy || !latestBatch}>
        {busy ? 'Saving…' : 'Record fishmeal'}
      </button>
      {!latestBatch && <p className="text-xs text-gray-400 mt-2">Record a feed first</p>}
      {msg && <p className={`text-xs mt-2 ${msg.includes('✓') ? 'text-green-700' : 'text-amber-700'}`}>{msg}</p>}
    </div>
  )
}

function OilOutForm({ latestBatch }: { latestBatch: Batch | null }) {
  const [totalKg, setTotalKg] = useState('')
  const { busy, msg, setMsg, submit } = useOutputSubmit(latestBatch, 'fishoil')
  const liveKg = Number(totalKg) || 0

  async function onSave() {
    if (!Number.isFinite(liveKg) || liveKg <= 0) return setMsg('How many kg of oil?')
    if (await submit({ bags: null, kg_per_bag: null, total_kg: liveKg })) setTotalKg('')
  }

  return (
    <div className="card p-4">
      <h2 className="font-bold text-gray-900 mb-1">⬆ Fish oil out</h2>
      <p className="text-xs text-gray-500 mb-3">Measured in kg, goes into the stock register</p>
      <div className="mb-2">
        <label className="label">Kg of oil</label>
        <input aria-label="Kg of oil" className="field num py-2" value={totalKg} onChange={(e) => setTotalKg(e.target.value)} inputMode="decimal" placeholder="750" />
      </div>
      {liveKg > 0 && (
        <p className="text-sm text-gray-700 mb-2">
          = <span className="num font-bold text-navy">{kg(liveKg)} kg</span> fish oil
        </p>
      )}
      <button className="btn-primary w-full" onClick={onSave} disabled={busy || !latestBatch}>
        {busy ? 'Saving…' : 'Record fish oil'}
      </button>
      {!latestBatch && <p className="text-xs text-gray-400 mt-2">Record a feed first</p>}
      {msg && <p className={`text-xs mt-2 ${msg.includes('✓') ? 'text-green-700' : 'text-amber-700'}`}>{msg}</p>}
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
            const outs = outputs.filter((o) => o.batch_id === b.id && ACTIVE_PRODUCTS.includes(o.product))
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
