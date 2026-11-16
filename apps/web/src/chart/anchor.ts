/**
 * Mapping between time and bar index that also works OUTSIDE the loaded candles.
 * The chart library only knows timestamps of loaded candles; drawings can have points to the right of the last
 * candle (a position's target) or left of the first loaded one. Those are extrapolated with the bar interval.
 * Pure — no chart-library types.
 */

/** Bar interval inferred from the last two candle times. */
export function inferInterval(times: number[], fallback = 60_000): number {
  const n = times.length
  if (n < 2) return fallback
  const d = times[n - 1] - times[n - 2]
  return d > 0 ? d : fallback
}

export function inRange(times: number[], t: number): boolean {
  return times.length > 0 && t >= times[0] && t <= times[times.length - 1]
}

/** Index of the bar containing `t` (floor); extrapolated before the first and after the last bar. */
export function timeToIndex(times: number[], t: number, interval: number): number {
  const n = times.length
  if (n === 0) return 0
  if (t <= times[0]) return Math.round((t - times[0]) / interval)
  if (t >= times[n - 1]) return n - 1 + Math.round((t - times[n - 1]) / interval)
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid
    else hi = mid
  }
  return lo
}

/** Time of the bar at `index`; extrapolated outside [0, n − 1]. */
export function indexToTime(times: number[], index: number, interval: number): number {
  const n = times.length
  if (n === 0) return 0
  const i = Math.round(index)
  if (i <= 0) return times[0] + i * interval
  if (i >= n - 1) return times[n - 1] + (i - (n - 1)) * interval
  return times[i]
}
