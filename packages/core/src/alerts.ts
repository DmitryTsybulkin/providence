import type { AlertCondition, AlertLine } from './types'

/**
 * Decide whether a condition is met when a value moves from `prev` to `cur`.
 *
 * - `cross`: prev and cur are on different sides of the threshold (touching counts when coming from a side).
 * - `above` / `below`: edge-triggered — fires when the value enters the zone. With no previous
 *   observation (`prev === null`) it fires if the value is already in the zone.
 *
 * `prevThreshold` lets the threshold itself move (a sloped trend line).
 */
export function conditionMet(
  condition: AlertCondition,
  prev: number | null,
  cur: number,
  threshold: number,
  prevThreshold: number = threshold,
): boolean {
  switch (condition) {
    case 'cross':
      if (prev === null) return false
      return (prev < prevThreshold && cur >= threshold) || (prev > prevThreshold && cur <= threshold)
    case 'above':
      return cur > threshold && (prev === null || prev <= prevThreshold)
    case 'below':
      return cur < threshold && (prev === null || prev >= prevThreshold)
  }
}

/**
 * Price of a drawn line at time `t`, or `null` when the line does not exist at that time
 * (outside a segment, behind a ray's origin, vertical line).
 */
export function lineValueAt(line: Pick<AlertLine, 'kind' | 'points'>, t: number): number | null {
  const [a, b] = line.points
  if (!a) return null
  if (line.kind === 'horizontal') return a.value
  if (!b || a.timestamp === b.timestamp) return null
  const value = a.value + ((b.value - a.value) * (t - a.timestamp)) / (b.timestamp - a.timestamp)
  if (line.kind === 'straight') return value
  const u = (t - a.timestamp) / (b.timestamp - a.timestamp)
  if (line.kind === 'ray') return u >= 0 ? value : null
  return u >= 0 && u <= 1 ? value : null
}

/** Minute bucket used to de-duplicate price/line alerts ("store last-fired candle time per alert"). */
export function minuteBucket(time: number): number {
  return Math.floor(time / 60_000) * 60_000
}
