import { useState } from 'react'
import type { Grn, Role } from '../lib/types'
import { kg, timeStr } from '../lib/format'
import { markReceived, rejectGrn, saveSampling, saveTare } from '../lib/grn'
import { divergenceFraction } from '../lib/yield'

// The truck's journey, in order. Each GRN status maps to "which step is next".
const STEPS = [
  { title: 'Weigh loaded truck', who: 'Weighbridge' },
  { title: 'Count & sample boxes', who: 'Receiving' },
  { title: 'Weigh empty truck', who: 'Weighbridge' },
  { title: 'Confirm received', who: 'Weighbridge or Receiving' },
]

// index of the CURRENT (not yet done) step; 4 = all done
function currentStep(g: Grn): number {
  switch (g.status) {
    case 'weighed_gross': return 1
    case 'sampling': return 2
    case 'weighed_tare': return 3
    default: return 4
  }
}

// which roles may act on each step (manager can always act)
const STEP_ROLES: Role[][] = [
  ['weighbridge', 'manager'],
  ['receiving', 'manager'],
  ['weighbridge', 'manager'],
  ['weighbridge', 'receiving', 'manager'],
]

function doneSummary(g: Grn, step: number): string {
  switch (step) {
    case 0: return `${kg(g.gross_kg)} kg loaded · ${timeStr(g.arrived_at)}`
    case 1: return `${g.total_boxes} boxes · boxes say ≈ ${kg(g.sampled_estimate_kg)} kg`
    case 2: return `${kg(g.tare_kg)} kg empty → net ${kg(g.net_kg)} kg on the scale`
    case 3: return `Received ${timeStr(g.received_at)}`
    default: return ''
  }
}

// Plain-words verdict comparing the two independent measures.
function CrossCheck({ grn }: { grn: Grn }) {
  const d = divergenceFraction(grn.net_kg, grn.sampled_estimate_kg)
  if (d == null) return null
  const apart = Math.abs(d * 100)
  const ok = apart <= 5
  return (
    <div className={`rounded-md px-3 py-2 text-sm ${ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
      {ok
        ? <>✓ Scale and boxes agree — only {apart.toFixed(1)}% apart</>
        : <>⚠ Numbers don't match — {apart.toFixed(0)}% apart. Scale says {kg(grn.net_kg)} kg, boxes say {kg(grn.sampled_estimate_kg)} kg. Re-check before confirming.</>}
    </div>
  )
}

export function TruckCard({ grn, role, profileId }: { grn: Grn; role: Role; profileId: string }) {
  const cur = currentStep(grn)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const canAct = cur < 4 && STEP_ROLES[cur].includes(role)

  async function act(fn: () => Promise<{ queued: boolean }>) {
    setBusy(true)
    setMsg(null)
    try {
      const { queued } = await fn()
      if (queued) setMsg('Saved on this device — will send when internet is back')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onReject() {
    if (!window.confirm(`Reject truck ${grn.vehicle_no}? It will be removed from the flow.`)) return
    await act(() => rejectGrn(grn.id, 'Rejected on floor'))
  }

  return (
    <div className="card p-4">
      {/* Header: the truck, in human terms */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-lg font-bold text-navy">{grn.vehicle_no}</div>
          <div className="text-xs text-gray-500">
            {[grn.species, grn.supplier, grn.register_no ? `Reg ${grn.register_no}` : null].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        {cur < 4 && (
          <span className="badge bg-gold-light text-gold-dark shrink-0">Step {cur + 1} of 4</span>
        )}
      </div>

      {/* The journey */}
      <ol className="space-y-2">
        {STEPS.map((s, i) => {
          const done = i < cur
          const isCurrent = i === cur
          return (
            <li key={i} className={`flex gap-3 ${!done && !isCurrent ? 'opacity-40' : ''}`}>
              <div
                className={`w-7 h-7 rounded-full grid place-items-center text-sm font-bold shrink-0 mt-0.5 ${
                  done ? 'bg-navy text-white' : isCurrent ? 'bg-gold text-white' : 'bg-gray-200 text-gray-500'
                }`}
              >
                {done ? '✓' : i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${isCurrent ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                  {s.title}
                </div>
                {done && <div className="text-xs text-gray-500 num">{doneSummary(grn, i)}</div>}
                {isCurrent && !canAct && (
                  <div className="text-xs text-gold-dark font-medium mt-0.5">
                    Waiting for the {s.who} team
                  </div>
                )}
                {isCurrent && canAct && (
                  <div className="mt-2">
                    {cur === 1 && <BoxesForm grn={grn} profileId={profileId} busy={busy} act={act} />}
                    {cur === 2 && <TareForm grn={grn} busy={busy} act={act} />}
                    {cur === 3 && (
                      <div className="space-y-2">
                        <CrossCheck grn={grn} />
                        <button className="btn-primary w-full" disabled={busy} onClick={() => act(() => markReceived(grn.id))}>
                          {busy ? 'Saving…' : `Confirm received — ${kg(grn.net_kg)} kg`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {msg && <p className="text-xs text-amber-700 mt-3">{msg}</p>}

      {cur < 4 && (
        <div className="mt-3 pt-2 border-t border-gray-100 text-right">
          <button className="text-xs text-red-500 underline" onClick={onReject} disabled={busy}>
            Reject this truck
          </button>
        </div>
      )}
    </div>
  )
}

function BoxesForm({ grn, profileId, busy, act }: { grn: Grn; profileId: string; busy: boolean; act: (fn: () => Promise<{ queued: boolean }>) => Promise<void> }) {
  const [total, setTotal] = useState('')
  const [sboxes, setSboxes] = useState('')
  const [sweight, setSweight] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const nT = Number(total) || 0
  const nS = Number(sboxes) || 0
  const nW = Number(sweight) || 0
  const estimate = nS > 0 ? (nW / nS) * nT : null

  function save() {
    setErr(null)
    if (!Number.isInteger(nT) || nT <= 0) return setErr('How many boxes in total?')
    if (!Number.isInteger(nS) || nS <= 0) return setErr('How many boxes did you weigh?')
    if (!Number.isFinite(nW) || nW <= 0) return setErr('What did those boxes weigh?')
    if (nS > nT) return setErr('Sample can’t be more than the total')
    void act(() => saveSampling(grn.id, { total_boxes: nT, sample_boxes: nS, sample_weight_kg: nW, receiving_by: profileId }))
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label">Total boxes</label>
          <input aria-label="Total boxes" className="field num py-2" value={total} onChange={(e) => setTotal(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <label className="label">Boxes weighed</label>
          <input aria-label="Boxes weighed" className="field num py-2" value={sboxes} onChange={(e) => setSboxes(e.target.value)} inputMode="numeric" placeholder="30" />
        </div>
        <div>
          <label className="label">Their weight kg</label>
          <input aria-label="Their weight kg" className="field num py-2" value={sweight} onChange={(e) => setSweight(e.target.value)} inputMode="decimal" placeholder="600" />
        </div>
      </div>
      {estimate != null && (
        <div className="text-sm text-gray-700">
          → Boxes say the truck holds ≈ <span className="num font-bold text-navy">{kg(estimate)} kg</span>
        </div>
      )}
      <button className="btn-primary w-full" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save box count'}
      </button>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
}

function TareForm({ grn, busy, act }: { grn: Grn; busy: boolean; act: (fn: () => Promise<{ queued: boolean }>) => Promise<void> }) {
  const [tare, setTare] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const nTare = Number(tare) || 0
  const net = grn.gross_kg != null && nTare > 0 ? grn.gross_kg - nTare : null

  function save() {
    setErr(null)
    if (!Number.isFinite(nTare) || nTare <= 0) return setErr('Enter the empty-truck weight')
    if (grn.gross_kg != null && nTare >= grn.gross_kg) return setErr('Empty weight must be less than the loaded weight')
    void act(() => saveTare(grn.id, nTare))
  }

  return (
    <div className="space-y-2">
      <label className="label">Empty truck + boxes (kg)</label>
      <div className="flex gap-2">
        <input aria-label="Empty truck + boxes (kg)" className="field num py-2" value={tare} onChange={(e) => setTare(e.target.value)} inputMode="decimal" placeholder="e.g. 8940" />
        <button className="btn-primary shrink-0" onClick={save} disabled={busy}>
          {busy ? '…' : 'Save'}
        </button>
      </div>
      {net != null && (
        <div className="text-sm text-gray-700">
          → Fish on the scale: <span className="num font-bold text-navy">{kg(net)} kg</span>
        </div>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
}
