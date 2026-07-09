import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useOpenShift } from '../lib/hooks'
import {
  createGrnGross,
  markReceived,
  rejectGrn,
  registerNoSeenToday,
  saveTare,
  subscribeGrn,
} from '../lib/grn'
import type { Grn } from '../lib/types'
import { divergenceFraction, isDivergent } from '../lib/yield'
import { kg } from '../lib/format'
import { DivergenceBadge, EmptyState, Notice, PageHeader, StatusBadge } from '../components/ui'

export function Weighbridge() {
  const { profile } = useAuth()
  const { shift } = useOpenShift()
  const [rows, setRows] = useState<Grn[]>([])
  useEffect(() => subscribeGrn(setRows), [])

  const today = new Date().toISOString().slice(0, 10)

  // New GRN (gross) form state
  const [f, setF] = useState({
    register_no: '',
    vehicle_no: '',
    supplier: '',
    driver_name: '',
    species: '',
    gross_kg: '',
  })
  const [dupWarn, setDupWarn] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const inProcess = useMemo(
    () => rows.filter((r) => ['weighed_gross', 'sampling', 'weighed_tare'].includes(r.status)),
    [rows],
  )
  const awaitingTare = inProcess.filter((r) => r.status === 'sampling')

  async function checkDup(v: string) {
    setF((s) => ({ ...s, register_no: v }))
    if (v.trim()) setDupWarn(await registerNoSeenToday(v, today))
    else setDupWarn(false)
  }

  async function submitGross() {
    setMsg(null)
    if (!shift) return
    if (!f.vehicle_no.trim()) return setMsg('Vehicle no is required')
    const gross = Number(f.gross_kg)
    if (!gross || gross <= 0) return setMsg('Enter a valid gross weight')
    setBusy(true)
    try {
      const { queued } = await createGrnGross({
        ...f,
        gross_kg: gross,
        shift_id: shift.id,
        weighbridge_by: profile!.id,
        entry_date: today,
      })
      setF({ register_no: '', vehicle_no: '', supplier: '', driver_name: '', species: '', gross_kg: '' })
      setDupWarn(false)
      setMsg(queued ? 'Saved offline — will sync when back online' : 'GRN created')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!shift) {
    return (
      <>
        <PageHeader title="Weighbridge" subtitle="Intake entry point" />
        <Notice tone="warn">
          No shift is open. A supervisor must <Link className="underline font-semibold" to="/shift">open a shift</Link>{' '}
          before trucks can be recorded.
        </Notice>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Weighbridge"
        subtitle={`${shift.label} shift · ${shift.business_date}`}
      />

      {msg && (
        <div className="mb-4">
          <Notice tone={msg.includes('offline') ? 'warn' : 'success'}>{msg}</Notice>
        </div>
      )}

      {/* New GRN — gross */}
      <div className="card p-4 mb-6">
        <h2 className="font-semibold text-gray-900 mb-3">New truck — record gross</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Register no (paper slip)</label>
            <input className="field num" value={f.register_no} onChange={(e) => checkDup(e.target.value)} inputMode="numeric" />
            {dupWarn && (
              <p className="text-xs text-amber-700 mt-1">⚠ This register no was already entered today — check it's not a duplicate.</p>
            )}
          </div>
          <div>
            <label className="label">Vehicle no</label>
            <input className="field" value={f.vehicle_no} onChange={(e) => setF((s) => ({ ...s, vehicle_no: e.target.value }))} />
          </div>
          <div>
            <label className="label">Species</label>
            <input className="field" value={f.species} onChange={(e) => setF((s) => ({ ...s, species: e.target.value }))} />
          </div>
          <div>
            <label className="label">Supplier</label>
            <input className="field" value={f.supplier} onChange={(e) => setF((s) => ({ ...s, supplier: e.target.value }))} />
          </div>
          <div>
            <label className="label">Driver</label>
            <input className="field" value={f.driver_name} onChange={(e) => setF((s) => ({ ...s, driver_name: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <label className="label">Gross weight — loaded truck (kg)</label>
            <input
              className="field num text-lg"
              value={f.gross_kg}
              onChange={(e) => setF((s) => ({ ...s, gross_kg: e.target.value }))}
              inputMode="decimal"
              placeholder="e.g. 24860"
            />
          </div>
        </div>
        <button className="btn-primary w-full mt-4" onClick={submitGross} disabled={busy}>
          {busy ? 'Saving…' : 'Create GRN'}
        </button>
      </div>

      {/* Awaiting tare */}
      <h2 className="font-semibold text-gray-900 mb-2">Awaiting tare ({awaitingTare.length})</h2>
      {awaitingTare.length === 0 ? (
        <EmptyState>No trucks are sampled and waiting for tare.</EmptyState>
      ) : (
        <div className="space-y-3 mb-6">
          {awaitingTare.map((g) => (
            <TareCard key={g.id} grn={g} onDone={() => {}} />
          ))}
        </div>
      )}

      {/* In-process list */}
      <h2 className="font-semibold text-gray-900 mb-2">In process ({inProcess.length})</h2>
      {inProcess.length === 0 ? (
        <EmptyState>No trucks in process.</EmptyState>
      ) : (
        <div className="space-y-2">
          {inProcess.map((g) => (
            <div key={g.id} className="card p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate">
                  {g.vehicle_no} {g.species ? `· ${g.species}` : ''}
                </div>
                <div className="text-xs text-gray-500 num">
                  Reg {g.register_no ?? '—'} · gross {kg(g.gross_kg)}
                  {g.net_kg ? ` · net ${kg(g.net_kg)}` : ''}
                </div>
              </div>
              <StatusBadge status={g.status} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function TareCard({ grn, onDone }: { grn: Grn; onDone: () => void }) {
  const { profile } = useAuth()
  const [tare, setTare] = useState('')
  const [saved, setSaved] = useState<number | null>(grn.tare_kg)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const net = grn.gross_kg != null && saved != null ? grn.gross_kg - saved : null
  const div = divergenceFraction(net, grn.sampled_estimate_kg)
  const flagged = isDivergent(net, grn.sampled_estimate_kg)

  async function onSaveTare() {
    setErr(null)
    const t = Number(tare)
    if (!t || t <= 0) return setErr('Enter a valid tare weight')
    if (grn.gross_kg != null && t >= grn.gross_kg) return setErr('Tare must be less than gross')
    setBusy(true)
    try {
      await saveTare(grn.id, t)
      setSaved(t)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onReceive() {
    setBusy(true)
    try {
      await markReceived(grn.id, profile!.id)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  async function onReject() {
    setBusy(true)
    try {
      await rejectGrn(grn.id, 'Rejected at weighbridge')
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-gray-900">
          {grn.vehicle_no} {grn.species ? `· ${grn.species}` : ''}
        </div>
        <StatusBadge status={grn.status} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm num mb-3">
        <div>
          <div className="label">Gross</div>
          <div className="font-semibold">{kg(grn.gross_kg)}</div>
        </div>
        <div>
          <div className="label">Boxes</div>
          <div className="font-semibold">{grn.total_boxes ?? '—'}</div>
        </div>
        <div>
          <div className="label">Box estimate</div>
          <div className="font-semibold">{kg(grn.sampled_estimate_kg)}</div>
        </div>
      </div>

      {saved == null ? (
        <>
          <label className="label">Tare — empty truck + boxes (kg)</label>
          <div className="flex gap-2">
            <input className="field num text-lg" value={tare} onChange={(e) => setTare(e.target.value)} inputMode="decimal" placeholder="e.g. 8940" />
            <button className="btn-primary shrink-0" onClick={onSaveTare} disabled={busy}>
              Save tare
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-md bg-teal-light px-3 py-2 mb-3">
            <span className="text-sm font-medium text-teal-dark">Net weight</span>
            <span className="num text-xl font-bold text-teal-dark">{kg(net)} kg</span>
          </div>
          {flagged && div != null && (
            <div className="mb-3 flex items-center gap-2">
              <DivergenceBadge fraction={div} />
              <span className="text-xs text-gray-500">net vs box estimate — review before receiving</span>
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={onReceive} disabled={busy}>
              Confirm received
            </button>
            <button className="btn-ghost text-red-600" onClick={onReject} disabled={busy}>
              Reject
            </button>
          </div>
        </>
      )}
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  )
}
