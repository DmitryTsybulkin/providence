/**
 * Pivot Points Standard (TradingView "Pivots"): levels for each period from the previous period's
 * high, low, close (and open). Formulas: https://www.tradingview.com/support/solutions/43000521824-pivot-points-standard/
 */
import type { Candle } from './types'

export const PIVOT_TYPES = ['traditional', 'fibonacci', 'woodie', 'classic', 'dm', 'camarilla'] as const
export type PivotType = (typeof PIVOT_TYPES)[number]
export const PIVOT_ANCHORS = ['auto', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const
export type PivotAnchor = (typeof PIVOT_ANCHORS)[number]
export type FixedAnchor = Exclude<PivotAnchor, 'auto'>

export const PIVOT_LEVELS = ['p', 'r1', 's1', 'r2', 's2', 'r3', 's3', 'r4', 's4', 'r5', 's5'] as const
export type PivotLevel = (typeof PIVOT_LEVELS)[number]
export type PivotLevels = Partial<Record<PivotLevel, number>>

export interface PeriodOhlc {
  open: number
  high: number
  low: number
  close: number
}

/**
 * Levels for one period. `prev` = previous period's OHLC; `currentOpen` = this period's open (Woodie only).
 * Levels a type does not define are left out.
 */
export function pivotLevels(type: PivotType, prev: PeriodOhlc, currentOpen: number): PivotLevels {
  const { open: o, high: h, low: l, close: c } = prev
  const range = h - l
  switch (type) {
    case 'traditional': {
      const p = (h + l + c) / 3
      return {
        p, r1: 2 * p - l, s1: 2 * p - h, r2: p + range, s2: p - range,
        r3: 2 * p + (h - 2 * l), s3: 2 * p - (2 * h - l), r4: 3 * p + (h - 3 * l), s4: 3 * p - (3 * h - l),
        r5: 4 * p + (h - 4 * l), s5: 4 * p - (4 * h - l),
      }
    }
    case 'fibonacci': {
      const p = (h + l + c) / 3
      return { p, r1: p + 0.382 * range, s1: p - 0.382 * range, r2: p + 0.618 * range, s2: p - 0.618 * range, r3: p + range, s3: p - range }
    }
    case 'woodie': {
      const p = (h + l + 2 * currentOpen) / 4
      const r3 = h + 2 * (p - l)
      const s3 = l - 2 * (h - p)
      return { p, r1: 2 * p - l, s1: 2 * p - h, r2: p + range, s2: p - range, r3, s3, r4: r3 + range, s4: s3 - range }
    }
    case 'classic': {
      const p = (h + l + c) / 3
      return {
        p, r1: 2 * p - l, s1: 2 * p - h, r2: p + range, s2: p - range,
        r3: p + 2 * range, s3: p - 2 * range, r4: p + 3 * range, s4: p - 3 * range,
      }
    }
    case 'dm': {
      const x = c < o ? h + 2 * l + c : c > o ? 2 * h + l + c : h + l + 2 * c
      return { p: x / 4, r1: x / 2 - l, s1: x / 2 - h }
    }
    case 'camarilla': {
      const p = (h + l + c) / 3
      const r5 = l === 0 ? NaN : (h / l) * c
      return {
        p, r1: c + (1.1 * range) / 12, s1: c - (1.1 * range) / 12, r2: c + (1.1 * range) / 6, s2: c - (1.1 * range) / 6,
        r3: c + (1.1 * range) / 4, s3: c - (1.1 * range) / 4, r4: c + (1.1 * range) / 2, s4: c - (1.1 * range) / 2,
        r5, s5: c - (r5 - c),
      }
    }
  }
}

const DAY = 86_400_000

/** "Auto" like TradingView: ≤ 15m → daily, other intraday → weekly, daily → monthly, above → yearly. */
export function autoAnchor(barMs: number): FixedAnchor {
  if (barMs <= 15 * 60_000) return 'daily'
  if (barMs < DAY) return 'weekly'
  if (barMs < 7 * DAY) return 'monthly'
  return 'yearly'
}

/** Start (UTC) of the period containing `t`. Weeks start on Monday 00:00 UTC. */
export function periodStart(t: number, anchor: FixedAnchor): number {
  const d = new Date(t)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  switch (anchor) {
    case 'daily':
      return Math.floor(t / DAY) * DAY
    case 'weekly': {
      const day = Math.floor(t / DAY) * DAY
      const weekday = (new Date(day).getUTCDay() + 6) % 7 // Monday = 0
      return day - weekday * DAY
    }
    case 'monthly':
      return Date.UTC(y, m, 1)
    case 'quarterly':
      return Date.UTC(y, m - (m % 3), 1)
    case 'yearly':
      return Date.UTC(y, 0, 1)
  }
}

/** Start of the period after the one starting at `start`. */
export function nextPeriodStart(start: number, anchor: FixedAnchor): number {
  const d = new Date(start)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  switch (anchor) {
    case 'daily':
      return start + DAY
    case 'weekly':
      return start + 7 * DAY
    case 'monthly':
      return Date.UTC(y, m + 1, 1)
    case 'quarterly':
      return Date.UTC(y, m + 3, 1)
    case 'yearly':
      return Date.UTC(y + 1, 0, 1)
  }
}

export interface PivotPeriod {
  /** Period start/end (UTC ms, end exclusive) */
  start: number
  end: number
  /** Index range of the loaded candles inside the period (end exclusive) */
  from: number
  to: number
  levels: PivotLevels
}

/**
 * Pivot levels for every period covered by `candles` (oldest first), keeping the last `back` periods.
 * A period gets levels only when the whole previous period is loaded — a partial previous period would give
 * wrong levels. Periods are built from the chart's own candles (crypto trades 24/7, so these match EOD data).
 */
export function pivotPeriods(candles: Candle[], type: PivotType, anchor: FixedAnchor, back: number): PivotPeriod[] {
  const groups: { start: number; from: number; to: number; ohlc: PeriodOhlc; complete: boolean }[] = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const start = periodStart(c.t, anchor)
    const g = groups[groups.length - 1]
    if (!g || g.start !== start) {
      groups.push({ start, from: i, to: i + 1, ohlc: { open: c.o, high: c.h, low: c.l, close: c.c }, complete: c.t === start })
    } else {
      g.to = i + 1
      g.ohlc.high = Math.max(g.ohlc.high, c.h)
      g.ohlc.low = Math.min(g.ohlc.low, c.l)
      g.ohlc.close = c.c
    }
  }
  const out: PivotPeriod[] = []
  for (let k = 1; k < groups.length; k++) {
    const prev = groups[k - 1]
    const cur = groups[k]
    // The previous period must be complete and directly precede this one.
    if (!prev.complete || nextPeriodStart(prev.start, anchor) !== cur.start) continue
    out.push({
      start: cur.start,
      end: nextPeriodStart(cur.start, anchor),
      from: cur.from,
      to: cur.to,
      levels: pivotLevels(type, prev.ohlc, cur.ohlc.open),
    })
  }
  return out.slice(-Math.max(1, Math.floor(back)))
}
