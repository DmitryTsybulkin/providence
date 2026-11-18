import { describe, expect, it } from 'vitest'
import {
  atr, bollinger, candleOpenTime, closedCandles, conditionMet, decimalsOf, ema, formatDuration, isCandleClosed,
  lineValueAt, macd, mergeCandles, parseSymbolKey, positionOutcome, positionStats, priceRangeStats, rma, rsi, sma, stoch, symbolKey, vwap,
  type Candle,
} from './index'

const H = 3_600_000
const candle = (t: number, c: number, h = c, l = c, v = 1): Candle => ({ t, o: c, h, l, c, v })

describe('timeframe', () => {
  it('aligns candle open times', () => {
    const t = Date.UTC(2026, 10, 16, 13, 47, 12)
    expect(candleOpenTime(t, '1m')).toBe(Date.UTC(2026, 10, 16, 13, 47))
    expect(candleOpenTime(t, '15m')).toBe(Date.UTC(2026, 10, 16, 13, 45))
    expect(candleOpenTime(t, '4h')).toBe(Date.UTC(2026, 10, 16, 12))
    expect(candleOpenTime(t, '1d')).toBe(Date.UTC(2026, 10, 16))
  })
  it('opens weekly candles on Monday 00:00 UTC', () => {
    // 2026-11-16 is a Monday; Thursday 19th belongs to the same week.
    expect(candleOpenTime(Date.UTC(2026, 10, 19, 5), '1w')).toBe(Date.UTC(2026, 10, 16))
    expect(candleOpenTime(Date.UTC(2026, 10, 15, 23, 59), '1w')).toBe(Date.UTC(2026, 10, 9))
  })
  it('treats a candle as closed only when the next one has opened', () => {
    expect(isCandleClosed(0, '1h', H - 1)).toBe(false)
    expect(isCandleClosed(0, '1h', H)).toBe(true)
    expect(closedCandles([candle(0, 1), candle(H, 2)], '1h', H + 5).map((c) => c.t)).toEqual([0])
  })
  it('builds and parses symbol keys', () => {
    expect(symbolKey('spot', 'BTCUSDT')).toBe('spot:BTCUSDT')
    expect(parseSymbolKey('linear:ETHUSDT')).toEqual({ category: 'linear', symbol: 'ETHUSDT' })
    expect(() => parseSymbolKey('BTCUSDT')).toThrow()
    expect(() => parseSymbolKey('inverse:BTCUSD')).toThrow()
  })
  it('merges candles, fresher wins, sorted', () => {
    const out = mergeCandles([candle(0, 1), candle(2, 3)], [candle(2, 9), candle(1, 2)])
    expect(out.map((c) => [c.t, c.c])).toEqual([[0, 1], [1, 2], [2, 9]])
  })
  it('counts decimals of a step', () => {
    expect(decimalsOf(0.1)).toBe(1)
    expect(decimalsOf(0.0001)).toBe(4)
    expect(decimalsOf(0.0000001)).toBe(7)
    expect(decimalsOf(5)).toBe(0)
    expect(decimalsOf(0.5)).toBe(1)
  })
})

describe('indicator math', () => {
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64]

  it('sma', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })
  it('ema is seeded with the SMA', () => {
    const out = ema([1, 2, 3, 4, 5], 3)
    expect(out.slice(0, 3)).toEqual([null, null, 2])
    expect(out[3]).toBeCloseTo(3, 10) // 4*0.5 + 2*0.5
    expect(out[4]).toBeCloseTo(4, 10)
  })
  it('rma (Wilder)', () => {
    const out = rma([1, 2, 3, 4], 2)
    expect(out).toEqual([null, 1.5, 2.25, 3.125])
  })
  it('rsi matches the classic Wilder worked example', () => {
    // StockCharts RSI(14) reference data: first RSI = 70.46, then 66.25, 66.48, 69.35, 66.29, 57.92
    const out = rsi(closes, 14)
    expect(out[13]).toBeNull()
    expect(out[14]).toBeCloseTo(70.46, 1)
    expect(out[15]).toBeCloseTo(66.25, 1)
    expect(out[16]).toBeCloseTo(66.48, 1)
    expect(out[17]).toBeCloseTo(69.35, 1)
    expect(out[18]).toBeCloseTo(66.29, 1)
    expect(out[19]).toBeCloseTo(57.92, 1)
  })
  it('rsi edge cases', () => {
    expect(rsi([1, 2, 3, 4], 3)[3]).toBe(100)
    expect(rsi([4, 3, 2, 1], 3)[3]).toBe(0)
    expect(rsi([1, 1, 1, 1], 3)[3]).toBe(50)
    expect(rsi([1, 2], 14)).toEqual([null, null])
  })
  it('atr', () => {
    const cs = [candle(0, 10, 11, 9), candle(1, 11, 12, 10), candle(2, 9, 11, 8), candle(3, 10, 10.5, 9.5)]
    // TR: 2, 2, 3, 1.5 → RMA(2): null, 2, 2.5, 2
    expect(atr(cs, 2)).toEqual([null, 2, 2.5, 2])
  })
  it('stoch', () => {
    const cs = [candle(0, 5, 10, 0), candle(1, 8, 10, 2), candle(2, 9, 12, 4)]
    const { k, d } = stoch(cs, 2, 1, 2)
    expect(k[0]).toBeNull()
    expect(k[1]).toBeCloseTo(80, 10) // (8-0)/(10-0)
    expect(k[2]).toBeCloseTo(70, 10) // (9-2)/(12-2)
    expect(d[1]).toBeNull()
    expect(d[2]).toBeCloseTo(75, 10)
  })
  it('vwap resets every UTC day', () => {
    const D = 86_400_000
    const cs = [candle(0, 10, 10, 10, 1), candle(H, 20, 20, 20, 3), candle(D, 30, 30, 30, 5)]
    expect(vwap(cs)).toEqual([10, 17.5, 30])
  })
  it('macd histogram = macd − signal', () => {
    const data = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10)
    const m = macd(data, 12, 26, 9)
    expect(m.macd[24]).toBeNull()
    expect(m.macd[25]).not.toBeNull()
    expect(m.signal[32]).toBeNull()
    expect(m.signal[33]).not.toBeNull()
    expect(m.hist[40]).toBeCloseTo((m.macd[40] as number) - (m.signal[40] as number), 12)
  })
  it('bollinger', () => {
    const b = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2)
    expect(b.mid[7]).toBe(5)
    expect(b.upper[7]).toBe(9) // population sd = 2
    expect(b.lower[7]).toBe(1)
  })
})

describe('alert conditions', () => {
  it('cross fires in both directions and needs a previous value', () => {
    expect(conditionMet('cross', null, 101, 100)).toBe(false)
    expect(conditionMet('cross', 99, 101, 100)).toBe(true)
    expect(conditionMet('cross', 101, 99, 100)).toBe(true)
    expect(conditionMet('cross', 99, 100, 100)).toBe(true)
    expect(conditionMet('cross', 101, 102, 100)).toBe(false)
    expect(conditionMet('cross', 100, 101, 100)).toBe(false) // was sitting on the level
  })
  it('above/below are edge-triggered', () => {
    expect(conditionMet('above', null, 71, 70)).toBe(true)
    expect(conditionMet('above', 69, 71, 70)).toBe(true)
    expect(conditionMet('above', 71, 72, 70)).toBe(false)
    expect(conditionMet('below', null, 29, 30)).toBe(true)
    expect(conditionMet('below', 31, 29, 30)).toBe(true)
    expect(conditionMet('below', 29, 28, 30)).toBe(false)
  })
  it('supports a moving threshold (trend line)', () => {
    // price flat at 100 while the line falls from 101 to 99 → cross
    expect(conditionMet('cross', 100, 100, 99, 101)).toBe(true)
  })
  it('evaluates lines in time', () => {
    const pts = [{ timestamp: 0, value: 100 }, { timestamp: 10, value: 110 }]
    expect(lineValueAt({ kind: 'horizontal', points: [pts[0]] }, 999)).toBe(100)
    expect(lineValueAt({ kind: 'segment', points: pts }, 5)).toBe(105)
    expect(lineValueAt({ kind: 'segment', points: pts }, 11)).toBeNull()
    expect(lineValueAt({ kind: 'ray', points: pts }, 20)).toBe(120)
    expect(lineValueAt({ kind: 'ray', points: pts }, -1)).toBeNull()
    expect(lineValueAt({ kind: 'straight', points: pts }, -10)).toBe(90)
    expect(lineValueAt({ kind: 'segment', points: [pts[0], pts[0]] }, 0)).toBeNull()
  })
})

describe('position maths', () => {
  it('matches the worked example in drawings.md §4', () => {
    const s = positionStats(100, 95, 115)
    expect(s.rr).toBe(3)
    expect(s.stopPct).toBe(-5)
    expect(s.takePct).toBe(15)
  })
  it('short position: profit below the entry is positive, the stop above is negative', () => {
    const s = positionStats(100, 104, 90, 'short')
    expect(s.rr).toBe(2.5)
    expect(s.stopPct).toBe(-4)
    expect(s.takePct).toBe(10)
  })
  it('finds which level is touched first after the entry bar', () => {
    const bar = (high: number, low: number, close = (high + low) / 2) => ({ high, low, close })
    const bars = [bar(101, 99), bar(102, 99), bar(116, 100), bar(120, 90)]
    // long 100 → take 115 / stop 95: bar 2 reaches 116
    expect(positionOutcome(bars, 0, 3, 'long', 95, 115)).toEqual({ kind: 'target', index: 2, price: 115 })
    // short 100 → take 90 / stop 105: bar 2 reaches 116 ≥ stop
    expect(positionOutcome(bars, 0, 3, 'short', 105, 90)).toEqual({ kind: 'stop', index: 2, price: 105 })
    // nothing touched inside the window → last bar's close
    expect(positionOutcome(bars, 0, 1, 'long', 95, 115)).toEqual({ kind: 'open', index: 1, price: 100.5 })
    // one bar touching both → stop first
    expect(positionOutcome(bars, 2, 3, 'long', 95, 119)).toEqual({ kind: 'stop', index: 3, price: 95 })
    // no bar after the entry (forecast in the future)
    expect(positionOutcome(bars, 3, 10, 'long', 95, 115)).toBeNull()
    expect(positionOutcome(bars, 1, 1, 'long', 95, 115)).toBeNull()
  })
  it('zero risk gives no R:R', () => {
    expect(positionStats(100, 100, 110).rr).toBeNull()
  })
  it('range stats and duration', () => {
    expect(priceRangeStats(200, 150)).toEqual({ delta: -50, pct: -25 })
    expect(formatDuration(3 * 86_400_000 + 4 * H)).toBe('3d 4h')
    expect(formatDuration(2 * H + 15 * 60_000)).toBe('2h 15m')
    expect(formatDuration(0)).toBe('0m')
  })
})
