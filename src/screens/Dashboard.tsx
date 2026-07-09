import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { useOpenShift } from '../lib/hooks'
import { computeShiftTotals, type ShiftTotals } from '../lib/shift'
import { divergenceFraction, isDivergent } from '../lib/yield'
import type { Grn, GrnPricing } from '../lib/types'
import { kg, money, pct } from '../lib/format'
import { DivergenceBadge, EmptyState, Notice, PageHeader, Stat } from '../components/ui'

export function Dashboard() {
  const { profile } = useAuth()
  const { shift } = useOpenShift()
  const [totals, setTotals] = useState<ShiftTotals | null>(null)
  const [received, setReceived] = useState<Grn[]>([])
  const [flags, setFlags] = useState<Grn[]>([])
  const [pricing, setPricing] = useState<Record<string, GrnPricing>>({})

  const load = useCallback(async () => {
    // Divergence flags across recent GRNs (net vs box estimate).
    const { data: recent } = await supabase
      .from('grn')
      .select('*')
      .in('status', ['weighed_tare', 'received'])
      .order('arrived_at', { ascending: false })
      .limit(100)
    const rows = (recent as Grn[]) ?? []
    setFlags(rows.filter((g) => isDivergent(g.net_kg, g.sampled_estimate_kg)))

    if (shift) {
      setTotals(await computeShiftTotals(shift))
      const { data: rec } = await supabase.from('grn').select('*').eq('shift_id', shift.id).eq('status', 'received')
      setReceived((rec as Grn[]) ?? [])
    } else {
      setTotals(null)
      setReceived([])
    }

    // Manager-only: pricing rows (RLS blocks everyone else).
    const { data: pr } = await supabase.from('grn_pricing').select('*')
    const map: Record<string, GrnPricing> = {}
    ;(pr as GrnPricing[] | null ?? []).forEach((p) => (map[p.grn_id] = p))
    setPricing(map)
  }, [shift])

  useEffect(() => {
    void load()
    const ch = supabase
      .channel('dash')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grn' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'batch' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'batch_output' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grn_pricing' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [load])

  async function saveRate(g: Grn, rate: number) {
    const amount = (g.net_kg ?? 0) * rate
    await supabase.from('grn_pricing').upsert(
      { grn_id: g.id, rate_per_kg: rate, amount, entered_by: profile!.id, entered_at: new Date().toISOString() },
      { onConflict: 'grn_id' },
    )
    await load()
  }

  const totalAmount = received.reduce((s, g) => s + (pricing[g.id]?.amount ?? 0), 0)

  return (
    <>
      <PageHeader title="Dashboard" subtitle={shift ? `Live · ${shift.label} shift · ${shift.business_date}` : 'No shift open'} />

      {!shift ? (
        <Notice tone="info">No shift is currently open. Open one from the Shift screen to see live totals.</Notice>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Opening" value={kg(shift.opening_balance_kg)} hint="kg" />
            <Stat label="Received" value={kg(totals?.received_kg)} hint="kg" />
            <Stat label="Fed" value={kg(totals?.fed_kg)} hint="kg" />
            <Stat label="Balance" value={kg(totals?.closing_balance_kg)} hint="kg" accent />
          </div>

          <div className="card p-4 mb-4">
            <h3 className="font-semibold text-gray-900 mb-3">Output &amp; running yield</h3>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Fishmeal" value={kg(totals?.fishmeal_kg)} hint={pct(totals?.yield_fishmeal_pct)} />
              <Stat label="Fish oil" value={kg(totals?.fishoil_kg)} hint={pct(totals?.yield_fishoil_pct)} />
              <Stat label="FSP" value={kg(totals?.fsp_kg)} hint={pct(totals?.yield_fsp_pct)} />
            </div>
          </div>
        </>
      )}

      {/* Divergence flags */}
      <div className="card p-4 mb-4">
        <h3 className="font-semibold text-gray-900 mb-3">Divergence flags ({flags.length})</h3>
        {flags.length === 0 ? (
          <EmptyState>No trucks exceed the 5% net-vs-estimate threshold.</EmptyState>
        ) : (
          <div className="space-y-2">
            {flags.map((g) => {
              const d = divergenceFraction(g.net_kg, g.sampled_estimate_kg)
              return (
                <div key={g.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">{g.vehicle_no}</span>{' '}
                    <span className="text-gray-500 num">net {kg(g.net_kg)} vs est {kg(g.sampled_estimate_kg)}</span>
                  </div>
                  {d != null && <DivergenceBadge fraction={d} />}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Rate entry — MANAGER ONLY (RLS enforced) */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Rate &amp; amount (manager only)</h3>
          <span className="num text-sm font-bold text-teal">Total {money(totalAmount)}</span>
        </div>
        {received.length === 0 ? (
          <EmptyState>No received trucks in the current shift to price.</EmptyState>
        ) : (
          <div className="space-y-3">
            {received.map((g) => (
              <RateRow key={g.id} grn={g} pricing={pricing[g.id]} onSave={(rate) => saveRate(g, rate)} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function RateRow({ grn, pricing, onSave }: { grn: Grn; pricing?: GrnPricing; onSave: (rate: number) => Promise<void> }) {
  const [rate, setRate] = useState(pricing?.rate_per_kg?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  const amount = (grn.net_kg ?? 0) * (Number(rate) || 0)

  async function save() {
    const r = Number(rate)
    if (!r || r <= 0) return
    setBusy(true)
    try {
      await onSave(r)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm truncate">{grn.vehicle_no}</div>
        <div className="text-xs text-gray-500 num">net {kg(grn.net_kg)} kg</div>
      </div>
      <input
        className="field num w-24 py-2"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
        inputMode="decimal"
        placeholder="rate/kg"
      />
      <div className="num text-sm font-semibold w-24 text-right">{money(amount)}</div>
      <button className="btn-primary py-2 text-sm shrink-0" onClick={save} disabled={busy}>
        {busy ? '…' : 'Save'}
      </button>
    </div>
  )
}
