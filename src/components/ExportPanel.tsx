import { useState } from 'react'
import {
  downloadCsv,
  exportIntake,
  exportPricing,
  exportProduction,
  exportShiftReports,
  type DateRange,
} from '../lib/export'
import { exportExcelWorkbook } from '../lib/excel'
import { Notice } from './ui'

type Key = 'excel' | 'reports' | 'intake' | 'production' | 'pricing'

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
      <p className="text-xs text-gray-500 mb-3">Files open in Excel / Google Sheets. Pick a date range, or leave blank for everything.</p>

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

      {/* The headline export: one formatted workbook with everything */}
      <button
        className="btn-primary w-full flex-col items-start text-left py-3 h-auto mb-3"
        disabled={busy != null}
        onClick={async () => {
          setBusy('excel')
          setMsg(null)
          try {
            await exportExcelWorkbook(range)
            setMsg({ tone: 'success', text: 'Excel workbook downloaded — 5 formatted sheets: shift reports, trucks, production, stock register, pricing.' })
          } catch (e) {
            setMsg({ tone: 'error', text: (e as Error).message })
          } finally {
            setBusy(null)
          }
        }}
      >
        <span className="font-bold">{busy === 'excel' ? 'Building workbook…' : '⬇ Full Excel workbook (.xlsx)'}</span>
        <span className="text-xs font-normal opacity-80">Everything in one formatted file — shift reports, trucks, production, stock register, pricing</span>
      </button>

      <p className="label">Or single files (CSV)</p>
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
