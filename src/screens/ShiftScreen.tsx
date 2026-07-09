import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useOpenShift } from '../lib/hooks'
import { closeShift, computeShiftTotals, getLastClosedShift, openShift, suggestShift, type ShiftTotals } from '../lib/shift'
import type { Shift } from '../lib/types'
import { kg, pct, timeStr } from '../lib/format'
import { EmptyState, Notice, PageHeader, Stat } from '../components/ui'
import { supabase } from '../lib/supabase'

export function ShiftScreen() {
  const { profile } = useAuth()
  const { shift, reload } = useOpenShift()
  const [totals, setTotals] = useState<ShiftTotals | null>(null)
  const [lastClosing, setLastClosing] = useState<number>(0)
  const suggestion = suggestShift()
  const [label, setLabel] = useState<'day' | 'night'>(suggestion.label)
  const [bizDate, setBizDate] = useState(suggestion.business_date)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)

  // Live totals for the open shift.
  useEffect(() => {
    if (!shift) {
      setTotals(null)
      return
    }
    const refresh = () => computeShiftTotals(shift).then(setTotals)
    void refresh()
    const ch = supabase
      .channel('shift-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grn' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'batch' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'batch_output' }, refresh)
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [shift])

  useEffect(() => {
    getLastClosedShift().then((s) => setLastClosing(s?.closing_balance_kg ?? 0))
  }, [shift])

  async function onOpen() {
    setMsg(null)
    setBusy(true)
    try {
      await openShift(label, bizDate, profile!.id)
      await reload()
      setMsg('Shift opened')
    } catch (e) {
      const m = (e as Error).message
      setMsg(m.includes('one_open_shift') ? 'A shift is already open — close it first.' : m)
    } finally {
      setBusy(false)
    }
  }

  async function onClose() {
    if (!shift) return
    setBusy(true)
    setMsg(null)
    try {
      // Leave the report unverified — QC (or a manager) verifies it separately in Reports.
      await closeShift(shift, null)
      await reload()
      setConfirmClose(false)
      setMsg('Shift closed — report frozen. Next shift opens with this closing balance.')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Shift" subtitle="Open, monitor and close the production shift" />

      {msg && (
        <div className="mb-4">
          <Notice tone={msg.includes('closed') || msg.includes('opened') ? 'success' : 'error'}>{msg}</Notice>
        </div>
      )}

      {shift ? (
        <OpenShiftPanel shift={shift} totals={totals} confirmClose={confirmClose} setConfirmClose={setConfirmClose} onClose={onClose} busy={busy} />
      ) : (
        <div className="card p-4">
          <h2 className="font-semibold text-gray-900 mb-1">Open a new shift</h2>
          <p className="text-sm text-gray-500 mb-4">
            Opening balance carries the last shift's closing balance:{' '}
            <span className="num font-semibold text-gray-800">{kg(lastClosing)} kg</span>.
          </p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="label">Shift</label>
              <select className="field" value={label} onChange={(e) => setLabel(e.target.value as 'day' | 'night')}>
                <option value="day">Day (08:00–20:00)</option>
                <option value="night">Night (20:00–08:00)</option>
              </select>
            </div>
            <div>
              <label className="label">Business date</label>
              <input className="field num" type="date" value={bizDate} onChange={(e) => setBizDate(e.target.value)} />
            </div>
          </div>
          <button className="btn-primary w-full" onClick={onOpen} disabled={busy}>
            {busy ? 'Opening…' : 'Open shift'}
          </button>
        </div>
      )}
    </>
  )
}

function OpenShiftPanel({
  shift,
  totals,
  confirmClose,
  setConfirmClose,
  onClose,
  busy,
}: {
  shift: Shift
  totals: ShiftTotals | null
  confirmClose: boolean
  setConfirmClose: (b: boolean) => void
  onClose: () => void
  busy: boolean
}) {
  return (
    <>
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-semibold text-gray-900 capitalize">{shift.label} shift</div>
            <div className="text-xs text-gray-500 num">
              {shift.business_date} · opened {timeStr(shift.started_at)}
            </div>
          </div>
          <span className="badge bg-green-100 text-green-800">Open</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Opening" value={kg(shift.opening_balance_kg)} hint="kg" />
          <Stat label="Received" value={kg(totals?.received_kg)} hint="kg" />
          <Stat label="Fed" value={kg(totals?.fed_kg)} hint="kg" />
          <Stat label="Closing (live)" value={kg(totals?.closing_balance_kg)} hint="kg" accent />
        </div>
      </div>

      <div className="card p-4 mb-4">
        <h3 className="font-semibold text-gray-900 mb-3">Output &amp; yield (live)</h3>
        {totals ? (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Fishmeal" value={kg(totals.fishmeal_kg)} hint={pct(totals.yield_fishmeal_pct)} />
            <Stat label="Fish oil" value={kg(totals.fishoil_kg)} hint={pct(totals.yield_fishoil_pct)} />
          </div>
        ) : (
          <EmptyState>Computing…</EmptyState>
        )}
      </div>

      {!confirmClose ? (
        <button className="btn-ghost w-full text-red-600 border-red-200" onClick={() => setConfirmClose(true)}>
          Close shift &amp; freeze report
        </button>
      ) : (
        <div className="card p-4 border-red-200">
          <p className="text-sm text-gray-700 mb-3">
            Closing freezes a report snapshot (received / fed / closing / output / three yields). Later edits won't change it.
            The next shift opens with a{' '}
            <span className="num font-semibold">{kg(totals?.closing_balance_kg)} kg</span> opening balance. Continue?
          </p>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={onClose} disabled={busy}>
              {busy ? 'Closing…' : 'Confirm close'}
            </button>
            <button className="btn-ghost" onClick={() => setConfirmClose(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}
