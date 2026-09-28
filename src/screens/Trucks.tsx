import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useOpenShift } from '../lib/hooks'
import { createGrnGross, registerNoSeenToday, subscribeGrn } from '../lib/grn'
import type { Grn } from '../lib/types'
import { kg, localDate } from '../lib/format'
import { EmptyState, Notice, PageHeader } from '../components/ui'
import { ShiftBanner } from '../components/ShiftBanner'
import { TruckCard } from '../components/TruckCard'

export function Trucks() {
  const { profile, role } = useAuth()
  const { shift, reload } = useOpenShift()
  const [rows, setRows] = useState<Grn[]>([])
  useEffect(() => subscribeGrn(setRows), [])

  const today = localDate()
  const inProgress = useMemo(
    () =>
      rows
        .filter((r) => ['weighed_gross', 'sampling', 'weighed_tare'].includes(r.status))
        .sort((a, b) => (a.arrived_at ?? '').localeCompare(b.arrived_at ?? '')), // oldest first — deal with them in order
    [rows],
  )
  const doneToday = useMemo(
    () => rows.filter((r) => ['received', 'rejected'].includes(r.status) && r.entry_date === today),
    [rows],
  )

  const canCreate = role === 'weighbridge' || role === 'manager'

  return (
    <>
      <PageHeader
        title="Trucks"
        subtitle="Every truck goes: weigh loaded → count boxes → weigh empty → confirm"
      />

      <ShiftBanner shift={shift} reload={reload} canControl={role === 'manager'} />

      {canCreate && shift && <NewTruckForm shiftId={shift.id} profileId={profile!.id} today={today} />}
      {canCreate && !shift && (
        <div className="mb-4">
          <Notice tone="warn">New trucks can be recorded once a shift is running.</Notice>
        </div>
      )}

      <h2 className="font-semibold text-gray-900 mb-2 mt-6">
        Trucks in progress {inProgress.length > 0 && `(${inProgress.length})`}
      </h2>
      {inProgress.length === 0 ? (
        <EmptyState>No trucks on the yard right now.</EmptyState>
      ) : (
        <div className="space-y-3">
          {inProgress.map((g) => (
            <TruckCard key={g.id} grn={g} role={role!} profileId={profile!.id} />
          ))}
        </div>
      )}

      <h2 className="font-semibold text-gray-900 mb-2 mt-6">Finished today {doneToday.length > 0 && `(${doneToday.length})`}</h2>
      {doneToday.length === 0 ? (
        <EmptyState>Nothing finished yet today.</EmptyState>
      ) : (
        <div className="space-y-2">
          {doneToday.map((g) => (
            <div key={g.id} className="card px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="font-semibold text-gray-900">{g.vehicle_no}</span>{' '}
                <span className="text-xs text-gray-500">{g.species ?? ''}</span>
              </div>
              {g.status === 'received' ? (
                <span className="num text-sm font-bold text-navy">{kg(g.net_kg)} kg ✓</span>
              ) : (
                <span className="badge bg-red-100 text-red-800">Rejected</span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function NewTruckForm({ shiftId, profileId, today }: { shiftId: string; profileId: string; today: string }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ register_no: '', vehicle_no: '', supplier: '', driver_name: '', species: '', gross_kg: '' })
  const [dupWarn, setDupWarn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function checkDup(v: string) {
    setF((s) => ({ ...s, register_no: v }))
    setDupWarn(v.trim() ? await registerNoSeenToday(v, today) : false)
  }

  async function submit() {
    setMsg(null)
    if (!f.vehicle_no.trim()) return setMsg('Type the vehicle number')
    const gross = Number(f.gross_kg)
    if (!Number.isFinite(gross) || gross <= 0) return setMsg('Type the loaded weight from the scale')
    setBusy(true)
    try {
      const { queued } = await createGrnGross({
        ...f,
        gross_kg: gross,
        shift_id: shiftId,
        weighbridge_by: profileId,
        entry_date: today,
      })
      setF({ register_no: '', vehicle_no: '', supplier: '', driver_name: '', species: '', gross_kg: '' })
      setDupWarn(false)
      setOpen(false)
      setMsg(queued ? 'Saved on this device — will send when internet is back' : null)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <>
        <button className="btn-primary w-full text-lg py-4" onClick={() => setOpen(true)}>
          + Truck arrived — weigh it in
        </button>
        {msg && <p className="text-xs text-amber-700 mt-2">{msg}</p>}
      </>
    )
  }

  return (
    <div className="card p-4 border-gold/50">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-gray-900">Step 1 — Weigh the loaded truck</h2>
        <button className="text-sm text-gray-400 underline" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Vehicle no</label>
          <input aria-label="Vehicle no" className="field" value={f.vehicle_no} onChange={(e) => setF((s) => ({ ...s, vehicle_no: e.target.value }))} placeholder="TN-01-4590" />
        </div>
        <div>
          <label className="label">Register no (paper slip)</label>
          <input aria-label="Register no (paper slip)" className="field num" value={f.register_no} onChange={(e) => checkDup(e.target.value)} inputMode="numeric" />
          {dupWarn && <p className="text-xs text-amber-700 mt-1">⚠ Already typed today — check it's not a duplicate</p>}
        </div>
        <div>
          <label className="label">Fish type</label>
          <input aria-label="Fish type" className="field" value={f.species} onChange={(e) => setF((s) => ({ ...s, species: e.target.value }))} placeholder="Sardine" />
        </div>
        <div>
          <label className="label">Supplier</label>
          <input aria-label="Supplier" className="field" value={f.supplier} onChange={(e) => setF((s) => ({ ...s, supplier: e.target.value }))} />
        </div>
        <div className="col-span-2">
          <label className="label">Driver</label>
          <input aria-label="Driver" className="field" value={f.driver_name} onChange={(e) => setF((s) => ({ ...s, driver_name: e.target.value }))} />
        </div>
        <div className="col-span-2">
          <label className="label">Weight on scale — truck full (kg)</label>
          <input
aria-label="Weight on scale — truck full (kg)"             className="field num text-xl"
            value={f.gross_kg}
            onChange={(e) => setF((s) => ({ ...s, gross_kg: e.target.value }))}
            inputMode="decimal"
            placeholder="24860"
          />
        </div>
      </div>
      <button className="btn-primary w-full mt-4" onClick={submit} disabled={busy}>
        {busy ? 'Saving…' : 'Save — send truck to unload'}
      </button>
      {msg && <p className="text-xs text-red-600 mt-2">{msg}</p>}
    </div>
  )
}
