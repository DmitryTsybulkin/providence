import type { Candle, Category, SymbolKey, Timeframe } from './types'

const MIN = 60_000

export const TF_MS: Record<Timeframe, number> = {
  '1m': MIN,
  '5m': 5 * MIN,
  '15m': 15 * MIN,
  '1h': 60 * MIN,
  '4h': 240 * MIN,
  '1d': 1440 * MIN,
  '1w': 7 * 1440 * MIN,
}

export function tfMs(tf: Timeframe): number {
  return TF_MS[tf]
}

/** 1970-01-05 was a Monday. Bybit weekly candles open on Monday 00:00 UTC. */
const MONDAY_OFFSET = 4 * 1440 * MIN

/** Open time of the candle that contains `time`. */
export function candleOpenTime(time: number, tf: Timeframe): number {
  const size = TF_MS[tf]
  if (tf === '1w') return Math.floor((time - MONDAY_OFFSET) / size) * size + MONDAY_OFFSET
  return Math.floor(time / size) * size
}

/** A candle is closed once the next one has opened. */
export function isCandleClosed(openTime: number, tf: Timeframe, now: number): boolean {
  return openTime + TF_MS[tf] <= now
}

/** Keep only closed candles (the only ones that may be written to the cache). */
export function closedCandles(candles: Candle[], tf: Timeframe, now: number): Candle[] {
  return candles.filter((c) => isCandleClosed(c.t, tf, now))
}

export function symbolKey(category: Category, symbol: string): SymbolKey {
  return `${category}:${symbol}`
}

export function parseSymbolKey(key: string): { category: Category; symbol: string } {
  const i = key.indexOf(':')
  const category = key.slice(0, i)
  if (i < 0 || (category !== 'linear' && category !== 'spot')) {
    throw new Error(`Invalid symbol key: ${key}`)
  }
  return { category, symbol: key.slice(i + 1) }
}

/**
 * Merge two oldest-first candle lists into one oldest-first list without duplicates.
 * On equal open time the candle from `b` wins (b is assumed fresher).
 */
export function mergeCandles(a: Candle[], b: Candle[]): Candle[] {
  const map = new Map<number, Candle>()
  for (const c of a) map.set(c.t, c)
  for (const c of b) map.set(c.t, c)
  return [...map.values()].sort((x, y) => x.t - y.t)
}

/** Number of decimals needed to print a step such as 0.001 → 3, 1e-7 → 7, 5 → 0. */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2
  let d = 0
  let x = step
  while (d < 12 && Math.abs(x - Math.round(x)) > 1e-9) {
    x *= 10
    d++
  }
  return d
}
