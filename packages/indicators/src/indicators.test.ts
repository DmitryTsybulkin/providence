import { describe, expect, it } from 'vitest'
import { atr, computeAlertIndicator, paramList, resolveParams, rsi, stoch, vwap } from '@providence/core'
import { customIndicators, toCandles, type BarData, type IndicatorTemplate } from './index'

// Deterministic pseudo-random walk, 300 bars of 1h
function bars(n = 300): BarData[] {
  let seed = 42
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  let price = 100
  return Array.from({ length: n }, (_, i) => {
    const open = price
    const close = open + (rnd() - 0.5) * 4
    const high = Math.max(open, close) + rnd()
    const low = Math.min(open, close) - rnd()
    price = close
    return { timestamp: Date.UTC(2026, 0, 1) + i * 3_600_000, open, high, low, close, volume: 10 + rnd() * 90 }
  })
}
const tpl = (id: string) => customIndicators.find((d) => d.id === id)!.template as IndicatorTemplate
const data = bars()
const candles = toCandles(data)

describe('custom indicators', () => {
  it('have unique ids and template names, and defaults that match calcParams', () => {
    const ids = customIndicators.map((d) => d.id)
    const names = customIndicators.map((d) => (d.template as IndicatorTemplate).name)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(names).size).toBe(names.length)
    for (const d of customIndicators) {
      expect(paramList(d.params, {})).toEqual((d.template as IndicatorTemplate).calcParams)
    }
  })
  it('return one row per bar', () => {
    for (const d of customIndicators) {
      const t = d.template as IndicatorTemplate
      expect(t.calc(data, { calcParams: t.calcParams })).toHaveLength(data.length)
    }
  })
  it('RSI template equals the shared maths; gaps are missing keys', () => {
    const out = tpl('rsi').calc(data, { calcParams: [14] })
    const ref = rsi(data.map((d) => d.close), 14)
    expect(out[13]).toEqual({})
    for (let i = 14; i < data.length; i++) expect(out[i].rsi).toBe(ref[i])
    expect(out.every((r) => r.rsi === undefined || (r.rsi >= 0 && r.rsi <= 100))).toBe(true)
  })
  it('ATR, VWAP and Stoch templates equal the shared maths', () => {
    const a = tpl('atr').calc(data, { calcParams: [14] })
    expect(a[200].atr).toBe(atr(candles, 14)[200])
    const v = tpl('vwap').calc(data, { calcParams: [] })
    expect(v[200].vwap).toBe(vwap(candles)[200])
    const s = tpl('stoch').calc(data, { calcParams: [14, 1, 3] })
    const ref = stoch(candles, 14, 1, 3)
    expect([s[200].k, s[200].d]).toEqual([ref.k[200], ref.d[200]])
  })
  it('chart indicator and alert indicator agree on a fixed candle set (alerts.md §6)', () => {
    const chartRsi = tpl('rsi').calc(data, { calcParams: [21] })
    const alertRsi = computeAlertIndicator('rsi', 21, candles)
    const chartAtr = tpl('atr').calc(data, { calcParams: [10] })
    const alertAtr = computeAlertIndicator('atr', 10, candles)
    for (const i of [21, 50, 150, 299]) {
      expect(chartRsi[i].rsi).toBe(alertRsi[i])
      expect(chartAtr[i].atr).toBe(alertAtr[i])
    }
  })
  it('VWAP stays between the session low and high', () => {
    const v = tpl('vwap').calc(data, { calcParams: [] })
    const day0 = data.slice(0, 24)
    const lo = Math.min(...day0.map((d) => d.low))
    const hi = Math.max(...day0.map((d) => d.high))
    for (let i = 0; i < 24; i++) {
      expect(v[i].vwap!).toBeGreaterThanOrEqual(lo)
      expect(v[i].vwap!).toBeLessThanOrEqual(hi)
    }
  })
})

describe('pivots template', () => {
  it('fills each bar of a period with its levels and period bounds', () => {
    const t = tpl('pivots')
    const out = t.calc(data, { calcParams: ['traditional', 'daily', 15, 'both', 1] })
    // 300 hourly bars from 2026-01-01 00:00 → day 0 has no previous day, days 1..12 get levels
    expect(out[23]).toEqual({})
    expect(out[24].p).toBeDefined()
    expect(out[24].start).toBe(Date.UTC(2026, 0, 2))
    expect(out[47].start).toBe(out[24].start)
    expect(out[48].start).toBe(Date.UTC(2026, 0, 3))
    const day0 = data.slice(0, 24)
    const h = Math.max(...day0.map((d) => d.high))
    const l = Math.min(...day0.map((d) => d.low))
    expect(out[24].p).toBeCloseTo((h + l + day0[23].close) / 3, 10)
  })
  it('auto picks weekly on an hourly chart and respects "pivots back"', () => {
    const out = tpl('pivots').calc(data, { calcParams: ['traditional', 'auto', 1, 'both', 1] })
    const starts = new Set(out.map((r) => r.start).filter((x) => x !== undefined))
    expect([...starts]).toEqual([Date.UTC(2026, 0, 12)]) // Mondays: 5th (first full week), 12th
  })
})

describe('params', () => {
  const schema = {
    length: { type: 'number', label: 'Length', default: 14, min: 2, max: 100 },
    mult: { type: 'number', label: 'Mult', default: 2 },
  } as const
  it('fills defaults, clamps, keeps schema order', () => {
    expect(resolveParams(schema, undefined)).toEqual({ length: 14, mult: 2 })
    expect(resolveParams(schema, { length: 1, mult: '2.5' })).toEqual({ length: 2, mult: 2.5 })
    expect(resolveParams(schema, { length: 'abc', mult: '' })).toEqual({ length: 14, mult: 2 })
    expect(paramList(schema, { mult: 3, length: 500 })).toEqual([100, 3])
  })
  it('resolves select params to a known option', () => {
    const sel = { kind: { type: 'select', label: 'K', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } } as const
    expect(resolveParams(sel as never, { kind: 'b' })).toEqual({ kind: 'b' })
    expect(resolveParams(sel as never, { kind: 'zzz' })).toEqual({ kind: 'a' })
    expect(resolveParams(sel as never, {})).toEqual({ kind: 'a' })
  })
})
