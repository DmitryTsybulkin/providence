import { describe, expect, it } from 'vitest'
import { autoAnchor, nextPeriodStart, periodStart, pivotLevels, pivotPeriods, type Candle } from './index'

const H = 3_600_000
const D = 24 * H
const prev = { open: 100, high: 120, low: 90, close: 110 }

describe('pivot levels', () => {
  it('traditional', () => {
    const l = pivotLevels('traditional', prev, 0)
    const p = 320 / 3
    expect(l.p).toBeCloseTo(p, 10)
    expect(l.r1).toBeCloseTo(2 * p - 90, 10)
    expect(l.s1).toBeCloseTo(2 * p - 120, 10)
    expect(l.r2).toBeCloseTo(p + 30, 10)
    expect(l.s2).toBeCloseTo(p - 30, 10)
    expect(l.r3).toBeCloseTo(2 * p + (120 - 180), 10)
    expect(l.s3).toBeCloseTo(2 * p - (240 - 90), 10)
    expect(l.r5).toBeCloseTo(4 * p + (120 - 360), 10)
    expect(l.s5).toBeCloseTo(4 * p - (480 - 90), 10)
  })
  it('fibonacci has levels 1–3 only', () => {
    const l = pivotLevels('fibonacci', prev, 0)
    expect(l.r1! - l.p!).toBeCloseTo(0.382 * 30, 10)
    expect(l.p! - l.s3!).toBeCloseTo(30, 10)
    expect(l.r4).toBeUndefined()
  })
  it('woodie uses the current open', () => {
    const l = pivotLevels('woodie', prev, 112)
    expect(l.p).toBe((120 + 90 + 224) / 4)
    expect(l.r4).toBeCloseTo(l.r3! + 30, 10)
    expect(l.r5).toBeUndefined()
  })
  it('classic', () => {
    const l = pivotLevels('classic', prev, 0)
    expect(l.r3! - l.p!).toBeCloseTo(60, 10)
    expect(l.p! - l.s4!).toBeCloseTo(90, 10)
  })
  it('DM depends on close vs open and has only P, R1, S1', () => {
    expect(pivotLevels('dm', prev, 0)).toEqual({ p: (240 + 90 + 110) / 4, r1: (240 + 90 + 110) / 2 - 90, s1: (240 + 90 + 110) / 2 - 120 })
    expect(pivotLevels('dm', { ...prev, close: 95 }, 0).p).toBe((120 + 180 + 95) / 4)
    expect(pivotLevels('dm', { ...prev, close: 100 }, 0).p).toBe((120 + 90 + 200) / 4)
  })
  it('camarilla', () => {
    const l = pivotLevels('camarilla', prev, 0)
    expect(l.r1).toBeCloseTo(110 + 33 / 12, 10)
    expect(l.s4).toBeCloseTo(110 - 33 / 2, 10)
    expect(l.r5).toBeCloseTo((120 / 90) * 110, 10)
    expect(l.s5).toBeCloseTo(110 - (l.r5! - 110), 10)
  })
})

describe('periods', () => {
  it('picks the auto anchor like TradingView', () => {
    expect(autoAnchor(60_000)).toBe('daily')
    expect(autoAnchor(15 * 60_000)).toBe('daily')
    expect(autoAnchor(H)).toBe('weekly')
    expect(autoAnchor(D)).toBe('monthly')
    expect(autoAnchor(7 * D)).toBe('yearly')
  })
  it('computes UTC period boundaries', () => {
    const t = Date.UTC(2026, 10, 18, 13, 30) // Wednesday
    expect(periodStart(t, 'daily')).toBe(Date.UTC(2026, 10, 18))
    expect(periodStart(t, 'weekly')).toBe(Date.UTC(2026, 10, 16))
    expect(periodStart(t, 'monthly')).toBe(Date.UTC(2026, 10, 1))
    expect(periodStart(t, 'quarterly')).toBe(Date.UTC(2026, 9, 1))
    expect(periodStart(t, 'yearly')).toBe(Date.UTC(2026, 0, 1))
    expect(nextPeriodStart(Date.UTC(2026, 10, 1), 'quarterly')).toBe(Date.UTC(2027, 1, 1))
    expect(nextPeriodStart(Date.UTC(2026, 11, 1), 'monthly')).toBe(Date.UTC(2027, 0, 1))
  })
  it('uses the previous complete day and keeps the last N periods', () => {
    const T = Date.UTC(2026, 0, 1)
    // 3 full days of 6h candles; day 0 closes at 110 with high 120 / low 90
    const candles: Candle[] = []
    for (let i = 0; i < 12; i++) {
      const day = Math.floor(i / 4)
      const c = 100 + day * 10 + (i % 4)
      candles.push({ t: T + i * 6 * H, o: c, h: c + (i === 1 ? 17 : 1), l: c - (i === 2 ? 11 : 1), c, v: 1 })
    }
    const periods = pivotPeriods(candles, 'traditional', 'daily', 15)
    expect(periods.map((p) => [p.start, p.from, p.to])).toEqual([[T + D, 4, 8], [T + 2 * D, 8, 12]])
    expect(periods[0].end).toBe(T + 2 * D)
    // day 0: high = 101 + 17 = 118, low = 102 - 11 = 91, close = 103
    expect(periods[0].levels.p).toBeCloseTo((118 + 91 + 103) / 3, 10)
    expect(pivotPeriods(candles, 'traditional', 'daily', 1).map((p) => p.start)).toEqual([T + 2 * D])
  })
  it('skips a period whose previous period is only partly loaded', () => {
    const T = Date.UTC(2026, 0, 1)
    const candles: Candle[] = [12, 18, 24, 30, 36].map((h) => ({ t: T + h * H, o: 1, h: 2, l: 0.5, c: 1, v: 1 }))
    // first candle at 12:00 → day 0 incomplete → day 1 (from 24:00) gets no levels
    expect(pivotPeriods(candles, 'traditional', 'daily', 15)).toEqual([])
  })
})
