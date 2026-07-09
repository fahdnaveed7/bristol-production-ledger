import type { ReactNode } from 'react'
import type { GrnStatus } from '../lib/types'
import { GRN_STATUS_LABEL } from '../lib/types'

export function StatusBadge({ status }: { status: GrnStatus }) {
  const styles: Record<GrnStatus, string> = {
    weighed_gross: 'bg-amber-100 text-amber-800',
    sampling: 'bg-blue-100 text-blue-800',
    weighed_tare: 'bg-indigo-100 text-indigo-800',
    received: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  }
  return <span className={`badge ${styles[status]}`}>{GRN_STATUS_LABEL[status]}</span>
}

export function DivergenceBadge({ fraction }: { fraction: number }) {
  const pctVal = (fraction * 100).toFixed(1)
  const sign = fraction > 0 ? '+' : ''
  return (
    <span className="badge bg-red-100 text-red-800" title="Weighbridge net vs box-sample estimate diverge beyond threshold">
      ⚠ {sign}
      {pctVal}%
    </span>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 no-print">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="card p-3">
      <div className="label">{label}</div>
      <div className={`num text-2xl font-bold ${accent ? 'text-navy' : 'text-gray-900'}`}>{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="card p-8 text-center text-gray-400 text-sm">{children}</div>
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const styles = {
    info: 'bg-navy-light text-navy-dark border-navy/30',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
    error: 'bg-red-50 text-red-800 border-red-200',
    success: 'bg-green-50 text-green-800 border-green-200',
  }
  return <div className={`rounded-md border px-3 py-2 text-sm ${styles[tone]}`}>{children}</div>
}
