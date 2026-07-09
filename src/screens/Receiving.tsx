import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useOpenShift } from '../lib/hooks'
import { saveSampling, subscribeGrn } from '../lib/grn'
import type { Grn } from '../lib/types'
import { divergenceFraction, isDivergent } from '../lib/yield'
import { kg } from '../lib/format'
import { DivergenceBadge, EmptyState, Notice, PageHeader, StatusBadge } from '../components/ui'

export function Receiving() {
  const { shift } = useOpenShift()
  const [rows, setRows] = useState<Grn[]>([])
  useEffect(() => subscribeGrn(setRows), [])

  const awaiting = useMemo(() => rows.filter((r) => r.status === 'weighed_gross'), [rows])
  const sampled = useMemo(() => rows.filter((r) => r.status === 'sampling'), [rows])

  return (
    <>
      <PageHeader
        title="Receiving"
        subtitle={shift ? `${shift.label} shift · ${shift.business_date}` : 'Box tally & sampling'}
      />

      {!shift && (
        <div className="mb-4">
          <Notice tone="warn">
            No shift is open. Ask a supervisor to <Link className="underline font-semibold" to="/shift">open a shift</Link>.
          </Notice>
        </div>
      )}

      <h2 className="font-semibold text-gray-900 mb-2">Awaiting box tally ({awaiting.length})</h2>
      {awaiting.length === 0 ? (
        <EmptyState>No trucks waiting for sampling.</EmptyState>
      ) : (
        <div className="space-y-3 mb-6">
          {awaiting.map((g) => (
            <SamplingCard key={g.id} grn={g} disabled={!shift} />
          ))}
        </div>
      )}

      <h2 className="font-semibold text-gray-900 mb-2">Sampled — awaiting tare ({sampled.length})</h2>
      {sampled.length === 0 ? (
        <EmptyState>Nothing sampled yet.</EmptyState>
      ) : (
        <div className="space-y-2">
          {sampled.map((g) => (
            <div key={g.id} className="card p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate">{g.vehicle_no}</div>
                <div className="text-xs text-gray-500 num">
                  {g.total_boxes} boxes · avg {kg(g.avg_box_kg, 1)} · est {kg(g.sampled_estimate_kg)} kg
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

function SamplingCard({ grn, disabled }: { grn: Grn; disabled: boolean }) {
  const { profile } = useAuth()
  const [total, setTotal] = useState('')
  const [sboxes, setSboxes] = useState('')
  const [sweight, setSweight] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const nTotal = Number(total) || 0
  const nSboxes = Number(sboxes) || 0
  const nSweight = Number(sweight) || 0
  const avg = nSboxes > 0 ? nSweight / nSboxes : null
  const estimate = avg != null ? avg * nTotal : null

  // Weighbridge net is usually not known yet at sampling; show divergence only if it is.
  const div = divergenceFraction(grn.net_kg, estimate)
  const flagged = isDivergent(grn.net_kg, estimate)

  async function save() {
    setErr(null)
    if (nTotal <= 0) return setErr('Enter total boxes')
    if (nSboxes <= 0) return setErr('Enter sample box count')
    if (nSweight <= 0) return setErr('Enter sample weight')
    if (nSboxes > nTotal) return setErr('Sample boxes cannot exceed total')
    setBusy(true)
    try {
      await saveSampling(grn.id, {
        total_boxes: nTotal,
        sample_boxes: nSboxes,
        sample_weight_kg: nSweight,
        receiving_by: profile!.id,
      })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-semibold text-gray-900">
            {grn.vehicle_no} {grn.species ? `· ${grn.species}` : ''}
          </div>
          <div className="text-xs text-gray-500 num">Reg {grn.register_no ?? '—'} · gross {kg(grn.gross_kg)}</div>
        </div>
        <StatusBadge status={grn.status} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label">Total boxes</label>
          <input className="field num" value={total} onChange={(e) => setTotal(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <label className="label">Sample boxes</label>
          <input className="field num" value={sboxes} onChange={(e) => setSboxes(e.target.value)} inputMode="numeric" placeholder="e.g. 30" />
        </div>
        <div>
          <label className="label">Sample wt (kg)</label>
          <input className="field num" value={sweight} onChange={(e) => setSweight(e.target.value)} inputMode="decimal" placeholder="e.g. 300" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="rounded-md bg-gray-50 px-3 py-2">
          <div className="label">Avg / box</div>
          <div className="num text-lg font-bold">{avg != null ? kg(avg, 1) : '—'} kg</div>
        </div>
        <div className="rounded-md bg-teal-light px-3 py-2">
          <div className="label">Estimate</div>
          <div className="num text-lg font-bold text-teal-dark">{estimate != null ? kg(estimate) : '—'} kg</div>
        </div>
      </div>

      {flagged && div != null && (
        <div className="mt-3 flex items-center gap-2">
          <DivergenceBadge fraction={div} />
          <span className="text-xs text-gray-500">vs weighbridge net {kg(grn.net_kg)}</span>
        </div>
      )}

      <button className="btn-primary w-full mt-4" onClick={save} disabled={busy || disabled}>
        {busy ? 'Saving…' : 'Save box tally'}
      </button>
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  )
}
