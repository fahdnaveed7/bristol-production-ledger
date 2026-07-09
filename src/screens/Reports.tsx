import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { useProfiles } from '../lib/hooks'
import type { ShiftReport } from '../lib/types'
import { kg, pct, dateStr, dateTimeStr } from '../lib/format'
import { EmptyState, Notice, PageHeader } from '../components/ui'

export function Reports() {
  const [reports, setReports] = useState<ShiftReport[]>([])
  const [selected, setSelected] = useState<ShiftReport | null>(null)

  async function load() {
    const { data } = await supabase.from('shift_report').select('*').order('generated_at', { ascending: false })
    setReports((data as ShiftReport[]) ?? [])
  }
  useEffect(() => {
    void load()
  }, [])

  if (selected) {
    return <ReportDetail report={selected} onBack={() => { setSelected(null); void load() }} />
  }

  return (
    <>
      <PageHeader title="Reports" subtitle="Frozen per-shift production reports" />
      {reports.length === 0 ? (
        <EmptyState>No shift reports yet. Close a shift to generate one.</EmptyState>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <button key={r.id} className="card p-3 w-full text-left flex items-center justify-between gap-3 hover:bg-gray-50" onClick={() => setSelected(r)}>
              <div>
                <div className="font-semibold text-gray-900 capitalize">
                  {r.label} shift · {dateStr(r.business_date)}
                </div>
                <div className="text-xs text-gray-500 num">
                  Received {kg(r.received_kg)} · Fed {kg(r.fed_kg)} · Meal {pct(r.yield_fishmeal_pct)}
                </div>
              </div>
              {r.verified_by ? (
                <span className="badge bg-green-100 text-green-800">✓ Verified</span>
              ) : (
                <span className="badge bg-amber-100 text-amber-800">Unverified</span>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function csvFor(r: ShiftReport): string {
  const rows: [string, string | number | null][] = [
    ['Report', 'Bristol Proteins & Oils — Fishmeal Daily Production Report (BPO/PRO/F/09)'],
    ['Business date', r.business_date],
    ['Shift', r.label],
    ['Opening balance (kg)', r.opening_balance_kg],
    ['Received (kg)', r.received_kg],
    ['Fed (kg)', r.fed_kg],
    ['Closing balance (kg)', r.closing_balance_kg],
    ['Fishmeal (kg)', r.fishmeal_kg],
    ['Fish oil (kg)', r.fishoil_kg],
    ['Fishmeal yield %', r.yield_fishmeal_pct?.toFixed(2) ?? ''],
    ['Fish oil yield %', r.yield_fishoil_pct?.toFixed(2) ?? ''],
    ['Generated at', r.generated_at],
  ]
  return rows.map(([k, v]) => `"${k}","${v ?? ''}"`).join('\n')
}

function ReportDetail({ report: r, onBack }: { report: ShiftReport; onBack: () => void }) {
  const { role, profile } = useAuth()
  const profiles = useProfiles()
  const [verifiedBy, setVerifiedBy] = useState(r.verified_by)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const canVerify = role === 'qc' || role === 'manager'

  async function verify() {
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.from('shift_report').update({ verified_by: profile!.id }).eq('id', r.id)
    if (error) setMsg(error.message)
    else {
      setVerifiedBy(profile!.id)
      setMsg('Report verified')
    }
    setBusy(false)
  }

  function downloadCsv() {
    const blob = new Blob([csvFor(r)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shift-report-${r.business_date}-${r.label}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className="flex justify-between py-2 border-b border-gray-100">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`num text-sm ${strong ? 'font-bold text-gray-900' : 'text-gray-800'}`}>{value}</span>
    </div>
  )

  return (
    <>
      <div className="flex items-center justify-between mb-4 no-print">
        <button className="text-sm text-navy font-semibold" onClick={onBack}>
          ← All reports
        </button>
        <div className="flex gap-2">
          <button className="btn-ghost py-2 text-sm" onClick={downloadCsv}>
            CSV
          </button>
          <button className="btn-ghost py-2 text-sm" onClick={() => window.print()}>
            Print
          </button>
          {canVerify && !verifiedBy && (
            <button className="btn-primary py-2 text-sm" onClick={verify} disabled={busy}>
              {busy ? '…' : 'QC verify'}
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className="mb-4 no-print">
          <Notice tone="success">{msg}</Notice>
        </div>
      )}

      <div className="card p-6 print-sheet">
        <div className="text-center border-b border-gray-300 pb-3 mb-4">
          <div className="font-bold text-gray-900">Bristol Proteins &amp; Oils</div>
          <div className="text-sm text-gray-600">Fishmeal Daily Production Report</div>
          <div className="text-xs text-gray-400">Doc No. BPO/PRO/F/09</div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 mb-4">
          <Row label="Business date" value={dateStr(r.business_date)} />
          <Row label="Shift" value={(r.label ?? '').toUpperCase()} />
        </div>

        <h3 className="font-semibold text-gray-900 text-sm uppercase tracking-wide mt-4 mb-1">Raw material balance</h3>
        <Row label="Opening balance" value={`${kg(r.opening_balance_kg)} kg`} />
        <Row label="Received" value={`${kg(r.received_kg)} kg`} />
        <Row label="Fed to production" value={`${kg(r.fed_kg)} kg`} />
        <Row label="Closing balance" value={`${kg(r.closing_balance_kg)} kg`} strong />

        <h3 className="font-semibold text-gray-900 text-sm uppercase tracking-wide mt-4 mb-1">Output &amp; yield</h3>
        <Row label="Fishmeal" value={`${kg(r.fishmeal_kg)} kg   ·   ${pct(r.yield_fishmeal_pct)}`} />
        <Row label="Fish oil" value={`${kg(r.fishoil_kg)} kg   ·   ${pct(r.yield_fishoil_pct)}`} />

        <div className="mt-6 pt-4 border-t border-gray-300 flex justify-between text-xs text-gray-500">
          <span>Generated {dateTimeStr(r.generated_at)}</span>
          <span>
            {verifiedBy ? `Verified by ${profiles[verifiedBy]?.name ?? '—'}` : 'Not yet verified'}
          </span>
        </div>
      </div>
    </>
  )
}
