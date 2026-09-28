import { useCallback, useEffect, useState } from 'react'
import { fetchStock, type StockDay } from '../lib/stock'
import { useRealtime } from '../lib/hooks'
import { kg, dateStr } from '../lib/format'
import { EmptyState, PageHeader, Stat, Notice } from '../components/ui'

export function Stock() {
  const [error, setError] = useState('')
  const [days, setDays] = useState<StockDay[]>([])
  const [totals, setTotals] = useState<StockDay | null>(null)

  const load = useCallback(() => {
    fetchStock().then(({ days, totals }) => {
      setDays(days)
      setTotals(totals)
    }).catch((e) => setError(e.message))
  }, [])

  useEffect(() => load(), [load])
  useRealtime(['batch_output', 'batch'], load)

  return (
    <>
      <PageHeader title="Stock register" subtitle="Everything produced, with the date it was made" />

      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="Fishmeal bags" value={totals ? String(totals.fishmealBags) : '—'} hint="total in register" accent />
        <Stat label="Fishmeal" value={kg(totals?.fishmealKg)} hint="kg total" />
        <Stat label="Fish oil" value={kg(totals?.fishoilKg)} hint="kg total" />
      </div>

      {days.length === 0 ? (
        <EmptyState>Nothing in the register yet — production output lands here automatically.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="px-3 py-2.5 label !mb-0">Produced on</th>
                <th className="px-3 py-2.5 label !mb-0 text-right">Meal bags</th>
                <th className="px-3 py-2.5 label !mb-0 text-right">Meal kg</th>
                <th className="px-3 py-2.5 label !mb-0 text-right">Oil kg</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date + d.label} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-gray-900">{dateStr(d.date)}</span>
                    {d.label && <span className="text-xs text-gray-400 capitalize"> · {d.label}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right num font-semibold">{d.fishmealBags || '—'}</td>
                  <td className="px-3 py-2.5 text-right num">{kg(d.fishmealKg)}</td>
                  <td className="px-3 py-2.5 text-right num">{kg(d.fishoilKg)}</td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                  <td className="px-3 py-2.5">Total</td>
                  <td className="px-3 py-2.5 text-right num">{totals.fishmealBags}</td>
                  <td className="px-3 py-2.5 text-right num">{kg(totals.fishmealKg)}</td>
                  <td className="px-3 py-2.5 text-right num">{kg(totals.fishoilKg)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </>
  )
}
