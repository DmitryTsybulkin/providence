/**
 * Indicator math shared by the chart (custom indicators in `packages/indicators`)
 * and the server alert engine, so both always compute the same numbers.
 * All functions are pure and return one value per input row; `null` = not enough data yet.
 */
import type { Candle } from './types'

export type Series = (number | null)[]

/** Simple moving average. */
export function sma(values: number[], length: number): Series {
  const out: Series = new Array(values.length).fill(null)
  if (length < 1) return out
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= length) sum -= values[i - length]
    if (i >= length - 1) out[i] = sum / length
  }
  return out
}

/** Exponential moving average, seeded with the SMA of the first `length` values (TradingView / KLineChart). */
export function ema(values: number[], length: number): Series {
  const out: Series = new Array(values.length).fill(null)
  if (length < 1) return out
  const k = 2 / (length + 1)
  let sum = 0
  let prev = 0
  for (let i = 0; i < values.length; i++) {
    if (i < length - 1) {
      sum += values[i]
    } else if (i === length - 1) {
      sum += values[i]
      prev = sum / length
      out[i] = prev
    } else {
      prev = values[i] * k + prev * (1 - k)
      out[i] = prev
    }
  }
  return out
}

/** Wilder's moving average (RMA), seeded with the SMA of the first `length` values. */
export function rma(values: number[], length: number): Series {
  const out: Series = new Array(values.length).fill(null)
  if (length < 1) return out
  let sum = 0
  let prev = 0
  for (let i = 0; i < values.length; i++) {
    if (i < length - 1) {
      sum += values[i]
    } else if (i === length - 1) {
      sum += values[i]
      prev = sum / length
      out[i] = prev
    } else {
      prev = (prev * (length - 1) + values[i]) / length
      out[i] = prev
    }
  }
  return out
}

/** Wilder's RSI (the TradingView / Bybit definition). First value at index `length`. */
export function rsi(closes: number[], length: number): Series {
  const out: Series = new Array(closes.length).fill(null)
  if (length < 1 || closes.length <= length) return out
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    if (i <= length) {
      avgGain += gain / length
      avgLoss += loss / length
      if (i < length) continue
    } else {
      avgGain = (avgGain * (length - 1) + gain) / length
      avgLoss = (avgLoss * (length - 1) + loss) / length
    }
    out[i] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

/** True range per candle. The first candle has no previous close, so TR = high − low. */
export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.h - c.l
    const pc = candles[i - 1].c
    return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc))
  })
}

/** Average true range with Wilder smoothing (TradingView default). */
export function atr(candles: Candle[], length: number): Series {
  return rma(trueRange(candles), length)
}

export interface StochResult {
  k: Series
  d: Series
}

/** Stochastic oscillator: %K = SMA(raw %K, smoothK), %D = SMA(%K, smoothD). */
export function stoch(candles: Candle[], length: number, smoothK: number, smoothD: number): StochResult {
  const raw: Series = candles.map((c, i) => {
    if (i < length - 1) return null
    let hh = -Infinity
    let ll = Infinity
    for (let j = i - length + 1; j <= i; j++) {
      if (candles[j].h > hh) hh = candles[j].h
      if (candles[j].l < ll) ll = candles[j].l
    }
    return hh === ll ? 50 : ((c.c - ll) / (hh - ll)) * 100
  })
  const k = smaOfSeries(raw, smoothK)
  const d = smaOfSeries(k, smoothD)
  return { k, d }
}

/** SMA over a series that starts with nulls. */
function smaOfSeries(series: Series, length: number): Series {
  const start = series.findIndex((v) => v !== null)
  const out: Series = new Array(series.length).fill(null)
  if (start < 0) return out
  const part = sma(series.slice(start) as number[], Math.max(1, length))
  for (let i = 0; i < part.length; i++) out[start + i] = part[i]
  return out
}

/** Session VWAP on typical price (HLC/3); the session resets at 00:00 UTC. */
export function vwap(candles: Candle[]): Series {
  const DAY = 86_400_000
  let day = NaN
  let pv = 0
  let vol = 0
  return candles.map((c) => {
    const d = Math.floor(c.t / DAY)
    if (d !== day) {
      day = d
      pv = 0
      vol = 0
    }
    const tp = (c.h + c.l + c.c) / 3
    pv += tp * c.v
    vol += c.v
    return vol > 0 ? pv / vol : tp
  })
}

export interface MacdResult {
  macd: Series
  signal: Series
  hist: Series
}

export function macd(closes: number[], fast: number, slow: number, signalLen: number): MacdResult {
  const f = ema(closes, fast)
  const s = ema(closes, slow)
  const line: Series = closes.map((_, i) => (f[i] !== null && s[i] !== null ? (f[i] as number) - (s[i] as number) : null))
  const start = line.findIndex((v) => v !== null)
  const signal: Series = new Array(closes.length).fill(null)
  if (start >= 0) {
    const part = ema(line.slice(start) as number[], signalLen)
    for (let i = 0; i < part.length; i++) signal[start + i] = part[i]
  }
  const hist: Series = line.map((v, i) => (v !== null && signal[i] !== null ? v - (signal[i] as number) : null))
  return { macd: line, signal, hist }
}

export interface BollingerResult {
  mid: Series
  upper: Series
  lower: Series
}

/** Bollinger bands with population standard deviation. */
export function bollinger(closes: number[], length: number, mult: number): BollingerResult {
  const mid = sma(closes, length)
  const upper: Series = new Array(closes.length).fill(null)
  const lower: Series = new Array(closes.length).fill(null)
  for (let i = length - 1; i < closes.length; i++) {
    const m = mid[i] as number
    let sq = 0
    for (let j = i - length + 1; j <= i; j++) sq += (closes[j] - m) ** 2
    const sd = Math.sqrt(sq / length)
    upper[i] = m + mult * sd
    lower[i] = m - mult * sd
  }
  return { mid, upper, lower }
}

// ---------- Indicators usable in alerts ----------

export const ALERT_INDICATORS = ['rsi', 'ema', 'sma', 'atr'] as const
export type AlertIndicatorId = (typeof ALERT_INDICATORS)[number]

/** One value per candle for an alert indicator. Throws on an unknown id. */
export function computeAlertIndicator(id: string, length: number, candles: Candle[]): Series {
  const closes = candles.map((c) => c.c)
  switch (id) {
    case 'rsi':
      return rsi(closes, length)
    case 'ema':
      return ema(closes, length)
    case 'sma':
      return sma(closes, length)
    case 'atr':
      return atr(candles, length)
    default:
      throw new Error(`Unknown alert indicator: ${id}`)
  }
}
