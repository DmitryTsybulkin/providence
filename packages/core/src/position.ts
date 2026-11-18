/** Long/short position maths (drawings.md §4). */

export type PositionSide = 'long' | 'short'

export interface PositionStats {
  /** |take − entry| / |entry − stop|; `null` when entry === stop */
  rr: number | null
  /**
   * Result at the stop, in % of entry, from the position's point of view:
   * long (stop − entry) / entry · 100, short (entry − stop) / entry · 100. Negative = a loss.
   */
  stopPct: number
  /** Result at the take profit, in % of entry, from the position's point of view. Positive = a profit. */
  takePct: number
}

export function positionStats(entry: number, stop: number, take: number, side: PositionSide = 'long'): PositionStats {
  const risk = Math.abs(entry - stop)
  const dir = side === 'long' ? 1 : -1
  return {
    rr: risk === 0 ? null : Math.abs(take - entry) / risk,
    stopPct: entry === 0 ? 0 : (dir * (stop - entry) / entry) * 100,
    takePct: entry === 0 ? 0 : (dir * (take - entry) / entry) * 100,
  }
}

export interface OhlcBar {
  high: number
  low: number
  close: number
}

export type PositionOutcome =
  /** Index of the bar where the target or the stop was first touched */
  | { kind: 'target' | 'stop'; index: number; price: number }
  /** Neither level touched; `index` = last bar inside the forecast window */
  | { kind: 'open'; index: number; price: number }

/**
 * Walk the bars after the entry bar (exclusive) up to the end bar (inclusive) and report which level is touched
 * first. If one bar touches both, the stop is assumed to come first (the conservative reading).
 * Returns `null` when there is no bar after the entry inside the window.
 */
export function positionOutcome(
  bars: readonly OhlcBar[],
  entryIndex: number,
  endIndex: number,
  side: PositionSide,
  stop: number,
  take: number,
): PositionOutcome | null {
  const from = Math.max(0, Math.floor(entryIndex) + 1)
  const to = Math.min(bars.length - 1, Math.floor(endIndex))
  if (from > to) return null
  for (let i = from; i <= to; i++) {
    const b = bars[i]
    const hitStop = side === 'long' ? b.low <= stop : b.high >= stop
    const hitTake = side === 'long' ? b.high >= take : b.low <= take
    if (hitStop) return { kind: 'stop', index: i, price: stop }
    if (hitTake) return { kind: 'target', index: i, price: take }
  }
  return { kind: 'open', index: to, price: bars[to].close }
}

export interface RangeStats {
  delta: number
  pct: number
}

/** Price range between two levels: Δ price and % relative to the first. */
export function priceRangeStats(from: number, to: number): RangeStats {
  return { delta: to - from, pct: from === 0 ? 0 : ((to - from) / from) * 100 }
}

/** Human duration such as "3d 4h", "2h 15m", "45m". */
export function formatDuration(ms: number): string {
  const total = Math.round(Math.abs(ms) / 60_000)
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  const parts: string[] = []
  if (d) parts.push(`${d}d`)
  if (h) parts.push(`${h}h`)
  if (m && !d) parts.push(`${m}m`)
  return parts.length ? parts.join(' ') : '0m'
}
