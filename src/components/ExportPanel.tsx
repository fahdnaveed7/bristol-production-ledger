import { useState } from 'react'
import {
  downloadCsv,
  exportIntake,
  exportPricing,
  exportProduction,
  exportShiftReports,
  type DateRange,
} from '../lib/export'
import { Notice } from './ui'

type Key = 'reports' | 'intake' | 'production' | 'pricing'

const DATASETS: { key: Key; label: string; hint: string; run: (r: DateRange) => Promise<{ rows: number; csv: string }>; file: string }[] = [
  { key: 'reports', label: 'Shift reports', hint: 'Frozen per-shift production summaries + yields', run: exportShiftReports, file: 'shift-reports' },
  { key: 'intake', label: 'Intake (GRNs)', hint: 'Every truck: weights, boxes, estimate, status', run: exportIntake, file: 'intake-grns' },
  { key: 'production', label: 'Batches & output', hint: 'Raw fed + product output per batch, with yields', run: exportProduction, file: 'production-batches' },
  { key: 'pricing', label: 'Rate & amount', hint: 'Manager-only: rate/kg and value per truck', run: exportPricing, file: 'pricing' },
]

export function ExportPanel() {
  const [range, setRange] = useState<DateRange>({})
  const [busy, setBusy] = useState<Key | null>(null)
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  async function run(d: (typeof DATASETS)[number]) {
    setBusy(d.key)
    setMsg(null)
    try {
      const { rows, csv } = await d.run(range)
      if (rows === 0) {
        setMsg({ tone: 'error', text: `No ${d.label.toLowerCase()} rows for this range.` })
        return
      }
      const span = range.from || range.to ? `_${range.from ?? 'start'}_to_${range.to ?? 'now'}` : ''
      downloadCsv(`bristol_${d.file}${span}.csv`, csv)
      setMsg({ tone: 'success', text: `Exported ${rows} ${d.label.toLowerCase()} row${rows === 1 ? '' : 's'}.` })
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card p-4">
      <h3 className="font-semibold text-gray-900 mb-1">Export production data</h3>
      <p className="text-xs text-gray-500 mb-3">Download as CSV (opens in Excel / Google Sheets). Date range is optional.</p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="label">From</label>
          <input className="field num py-2" type="date" value={range.from ?? ''} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value || undefined }))} />
        </div>
        <div>
          <label className="label">To</label>
          <input className="field num py-2" type="date" value={range.to ?? ''} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value || undefined }))} />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        {DATASETS.map((d) => (
          <button key={d.key} className="btn-ghost flex-col items-start text-left py-3 h-auto" onClick={() => run(d)} disabled={busy != null}>
            <span className="font-semibold text-navy">{busy === d.key ? 'Preparing…' : `⬇ ${d.label}`}</span>
            <span className="text-xs font-normal text-gray-500">{d.hint}</span>
          </button>
        ))}
      </div>

      {msg && (
        <div className="mt-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
    </div>
  )
}
