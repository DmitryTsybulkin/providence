import { describe, expect, it } from 'vitest'
import type { Candle } from '@providence/core'
import { candlesToCsv, exportFileName, parseLegacyJson, toLegacyJson } from './export'

const candles: Candle[] = [
  { t: Date.UTC(2026, 10, 16, 12), o: 100, h: 110, l: 95, c: 105.5, v: 12.5 },
  { t: Date.UTC(2026, 10, 16, 13), o: 105.5, h: 106, l: 101, c: 102, v: 3 },
]
const input = {
  symbol: 'BTCUSDT', category: 'linear', tf: '1h', candles, now: Date.UTC(2026, 10, 16, 14),
  indicators: [{ id: 'ema', name: 'EMA', params: [9], keys: ['ema1'], data: [[candles[0].t, null], [candles[1].t, 103.2]] }],
} as const

describe('export', () => {
  it('writes CSV with ISO UTC time', () => {
    expect(candlesToCsv(candles)).toBe(
      'time,open,high,low,close,volume\n2026-11-16T12:00:00.000Z,100,110,95,105.5,12.5\n2026-11-16T13:00:00.000Z,105.5,106,101,102,3\n',
    )
    expect(candlesToCsv([])).toBe('time,open,high,low,close,volume\n')
  })
  it('writes the legacy JSON shape', () => {
    const doc = toLegacyJson({ ...input, candles: [...candles], indicators: [...input.indicators] as never })
    expect(doc.meta).toMatchObject({ symbol: 'BTCUSDT', category: 'linear', source: 'bybit', exportedAt: '2026-11-16T14:00:00.000Z' })
    expect(doc.chart).toEqual({ type: 'Candles', tf: '1h', data: [[candles[0].t, 100, 110, 95, 105.5, 12.5], [candles[1].t, 105.5, 106, 101, 102, 3]] })
    expect(doc.indicators).toEqual([{ name: 'EMA', params: [9], keys: ['ema1'], data: [[candles[0].t, null], [candles[1].t, 103.2]] }])
  })
  it('round-trips through JSON for viewing', () => {
    const text = JSON.stringify(toLegacyJson({ ...input, candles: [...candles], indicators: [...input.indicators] as never }))
    expect(parseLegacyJson(text)).toEqual({ symbol: 'BTCUSDT', tf: '1h', candles, indicatorCount: 1 })
  })
  it('accepts the bare legacy shape, sorts rows and tolerates a missing volume', () => {
    const out = parseLegacyJson(JSON.stringify({ chart: { type: 'Candles', tf: '2h', data: [[2, 1, 1, 1, 1], [1, 2, 2, 2, 2, 5]] } }))
    expect(out).toEqual({ symbol: 'imported', tf: null, indicatorCount: 0, candles: [{ t: 1, o: 2, h: 2, l: 2, c: 2, v: 5 }, { t: 2, o: 1, h: 1, l: 1, c: 1, v: 0 }] })
  })
  it('rejects other files with a clear message', () => {
    expect(() => parseLegacyJson('time,open')).toThrow('Not a JSON file')
    expect(() => parseLegacyJson('{"a":1}')).toThrow('Missing chart.data')
    expect(() => parseLegacyJson('{"chart":{"data":[]}}')).toThrow('empty')
    expect(() => parseLegacyJson('{"chart":{"data":[[1,"x",1,1,1,1]]}}')).toThrow('non-numeric')
  })
  it('names files SYMBOL_TF_yyyyMMdd-HHmm.ext', () => {
    const local = new Date(2026, 10, 16, 9, 5).getTime()
    expect(exportFileName('BTCUSDT', '4h', 'png', local)).toBe('BTCUSDT_4h_20261116-0905.png')
  })
})
