import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { closeShift, computeShiftTotals, getLastClosedShift, openShift, suggestShift, type ShiftTotals } from '../lib/shift'
import { useRealtime } from '../lib/hooks'
import type { Shift } from '../lib/types'
import { kg, timeStr } from '../lib/format'

// One banner, everywhere: is a shift running, how much fish is in store,
// and (for production/manager) the start/end controls — right where people work.
export function ShiftBanner({ shift, reload, canControl }: { shift: Shift | null; reload: () => void; canControl: boolean }) {
  const { profile } = useAuth()
  const [totals, setTotals] = useState<ShiftTotals | null>(null)
  const [lastClosing, setLastClosing] = useState(0)
  const [ending, setEnding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const suggestion = suggestShift()
  const [label, setLabel] = useState<'day' | 'night'>(suggestion.label)
  const [bizDate, setBizDate] = useState(suggestion.business_date)

  const refresh = useCallback(() => {
    if (shift) computeShiftTotals(shift).then(setTotals)
  }, [shift])

  useEffect(() => {
    refresh()
    if (!shift) getLastClosedShift().then((s) => setLastClosing(s?.closing_balance_kg ?? 0))
  }, [shift, refresh])
  useRealtime(['grn', 'batch', 'batch_output'], refresh)

  async function onStart() {
    setBusy(true)
    setErr(null)
    try {
      await openShift(label, bizDate, profile?.id ?? null)
      reload()
    } catch (e) {
      const m = (e as Error).message
      setErr(m.includes('one_open_shift') ? 'A shift is already running — refresh.' : m)
    } finally {
      setBusy(false)
    }
  }

  async function onEnd() {
    if (!shift) return
    setBusy(true)
    setErr(null)
    try {
      await closeShift(shift, null) // QC verifies later, in Reports
      setEnding(false)
      reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ---------- no shift running ----------
  if (!shift) {
    return (
      <div className="card p-4 mb-4 border-gold/40 bg-gold-light/50">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
          <span className="font-bold text-gray-900">No shift running</span>
        </div>
        {canControl ? (
          <>
            <p className="text-sm text-gray-600 mb-3">
              Start one to begin recording. It will open with{' '}
              <span className="num font-semibold">{kg(lastClosing)} kg</span> in store (carried from the last shift).
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="label">Shift</label>
                <select className="field py-2 w-44" value={label} onChange={(e) => setLabel(e.target.value as 'day' | 'night')}>
                  <option value="day">Day (8am – 8pm)</option>
                  <option value="night">Night (8pm – 8am)</option>
                </select>
              </div>
              <div>
                <label className="label">Date</label>
                <input className="field num py-2" type="date" value={bizDate} onChange={(e) => setBizDate(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={onStart} disabled={busy}>
                {busy ? 'Starting…' : 'Start shift'}
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-600">Recording is paused until the production team starts a shift.</p>
        )}
        {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
      </div>
    )
  }

  // ---------- shift running ----------
  const t = totals
  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span className="font-bold text-gray-900 capitalize">{shift.label} shift running</span>
          <span className="text-xs text-gray-400">since {timeStr(shift.started_at)}</span>
        </div>
        {canControl && !ending && (
          <button className="btn-ghost py-1.5 px-3 text-sm" onClick={() => setEnding(true)}>
            End shift
          </button>
        )}
      </div>

      {/* The one number everyone cares about, plus the equation behind it */}
      <div className="mt-3 flex items-baseline gap-2">
        <span className="num text-3xl font-bold text-navy">{kg(t?.closing_balance_kg)}</span>
        <span className="text-sm text-gray-500">kg fish in store right now</span>
      </div>
      <p className="text-xs text-gray-400 num mt-1">
        started with {kg(shift.opening_balance_kg)} + trucks brought {kg(t?.received_kg)} − fed to plant {kg(t?.fed_kg)}
      </p>

      {ending && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50/50 p-3">
          <p className="text-sm text-gray-700 mb-2">
            Ending the shift saves today's report and <b>locks it</b> — later edits won't change it. The{' '}
            <span className="num font-semibold">{kg(t?.closing_balance_kg)} kg</span> in store carries to the next shift.
          </p>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={onEnd} disabled={busy}>
              {busy ? 'Ending…' : 'Yes, end shift'}
            </button>
            <button className="btn-ghost" onClick={() => setEnding(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  )
}
