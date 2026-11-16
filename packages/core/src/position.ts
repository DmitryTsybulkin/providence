/** Long/short position maths (drawings.md §4). */

export interface PositionStats {
  /** |take − entry| / |entry − stop|; `null` when entry === stop */
  rr: number | null
  /** (stop − entry) / entry · 100 */
  stopPct: number
  /** (take − entry) / entry · 100 */
  takePct: number
}

export function positionStats(entry: number, stop: number, take: number): PositionStats {
  const risk = Math.abs(entry - stop)
  return {
    rr: risk === 0 ? null : Math.abs(take - entry) / risk,
    stopPct: entry === 0 ? 0 : ((stop - entry) / entry) * 100,
    takePct: entry === 0 ? 0 : ((take - entry) / entry) * 100,
  }
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
