// Single source of truth for yield math (mirrors the three percentages on BPO/PRO/F/09).
// Per-product yield = product_kg / raw_fed_kg * 100.

export function yieldPct(productKg: number | null | undefined, fedKg: number | null | undefined): number | null {
  const p = productKg ?? 0
  const f = fedKg ?? 0
  if (f <= 0) return null
  return (p / f) * 100
}

// Divergence between the two independent raw-material measures.
// Returns the signed fraction (estimate - net) / net, or null if net is unusable.
export function divergenceFraction(netKg: number | null | undefined, estimateKg: number | null | undefined): number | null {
  const n = netKg ?? 0
  const e = estimateKg ?? null
  if (!n || e == null) return null
  return (e - n) / n
}

export const DEFAULT_DIVERGENCE_THRESHOLD = 0.05

export function isDivergent(
  netKg: number | null | undefined,
  estimateKg: number | null | undefined,
  threshold = DEFAULT_DIVERGENCE_THRESHOLD,
): boolean {
  const d = divergenceFraction(netKg, estimateKg)
  if (d == null) return false
  return Math.abs(d) > threshold
}

// Resolve an output row's kg: explicit total_kg wins, else bags * kg_per_bag.
export function outputKg(row: { total_kg?: number | null; bags?: number | null; kg_per_bag?: number | null }): number {
  if (row.total_kg != null && row.total_kg > 0) return row.total_kg
  const bags = row.bags ?? 0
  const per = row.kg_per_bag ?? 0
  return bags * per
}
