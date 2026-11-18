/** Export formats (export.md). Pure functions; the download itself happens in the component. */
import { TIMEFRAMES, type Candle, type Category, type Timeframe } from '@providence/core'
import type { IndicatorSeries } from '../chart'
import { formatFileStamp } from './format'

/** CSV: `time,open,high,low,close,volume` with ISO-8601 UTC time. */
export function candlesToCsv(candles: Candle[]): string {
  const lines = ['time,open,high,low,close,volume']
  for (const c of candles) lines.push(`${new Date(c.t).toISOString()},${c.o},${c.h},${c.l},${c.c},${c.v}`)
  return lines.join('\n') + '\n'
}

/** Legacy Tradebot shape — also the future bot → UI contract. */
export interface LegacyExport {
  meta: { app: 'providence'; version: 1; source: string; symbol: string; category: Category; exportedAt: string }
  chart: { type: 'Candles'; tf: Timeframe; data: [number, number, number, number, number, number][] }
  indicators: { name: string; params: (number | string)[]; keys?: string[]; data: (number | null)[][] }[]
}

export interface ExportInput {
  symbol: string
  category: Category
  tf: Timeframe
  candles: Candle[]
  indicators: IndicatorSeries[]
  now: number
}

export function toLegacyJson(p: ExportInput): LegacyExport {
  return {
    meta: { app: 'providence', version: 1, source: 'bybit', symbol: p.symbol, category: p.category, exportedAt: new Date(p.now).toISOString() },
    chart: { type: 'Candles', tf: p.tf, data: p.candles.map((c) => [c.t, c.o, c.h, c.l, c.c, c.v]) },
    indicators: p.indicators.map((i) => ({ name: i.name, params: i.params, keys: i.keys, data: i.data })),
  }
}

export interface ImportedChart {
  symbol: string
  tf: Timeframe | null
  candles: Candle[]
  indicatorCount: number
}

/** Parse a legacy JSON export for viewing. Throws with a readable message on anything that is not that format. */
export function parseLegacyJson(text: string): ImportedChart {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    throw new Error('Not a JSON file')
  }
  const o = doc as { meta?: { symbol?: unknown }; chart?: { tf?: unknown; data?: unknown }; indicators?: unknown }
  if (!o || typeof o !== 'object' || !o.chart || !Array.isArray(o.chart.data)) throw new Error('Missing chart.data')
  const candles: Candle[] = []
  for (const row of o.chart.data as unknown[]) {
    if (!Array.isArray(row) || row.length < 5) throw new Error('chart.data rows must be [t, o, h, l, c, v]')
    const [t, open, h, l, c, v] = row.map(Number)
    if (![t, open, h, l, c].every(Number.isFinite)) throw new Error('chart.data contains non-numeric values')
    candles.push({ t, o: open, h, l, c, v: Number.isFinite(v) ? v : 0 })
  }
  if (candles.length === 0) throw new Error('chart.data is empty')
  candles.sort((a, b) => a.t - b.t)
  const tf = TIMEFRAMES.includes(o.chart.tf as Timeframe) ? (o.chart.tf as Timeframe) : null
  return {
    symbol: typeof o.meta?.symbol === 'string' ? o.meta.symbol : 'imported',
    tf,
    candles,
    indicatorCount: Array.isArray(o.indicators) ? o.indicators.length : 0,
  }
}

/** `SYMBOL_TF_yyyyMMdd-HHmm.ext` (local time). */
export function exportFileName(symbol: string, tf: Timeframe, ext: string, now: number): string {
  return `${symbol}_${tf}_${formatFileStamp(now)}.${ext}`
}
