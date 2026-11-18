/**
 * Structural types for a chart-library indicator template. They mirror KLineChart 9's
 * `IndicatorTemplate`, but this package must not import the chart library (only
 * `apps/web/src/chart/` may), so the shape is declared here and cast at registration time.
 */
import type { Candle } from '@providence/core'

export interface BarData {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface FigureDef {
  key: string
  title: string
  type: 'line' | 'bar' | 'circle'
}

export type IndicatorRow = Record<string, number | undefined>

export interface IndicatorTemplate {
  /** Unique name inside the chart library */
  name: string
  shortName: string
  /** 'price' = uses the symbol's price precision; 'normal' = uses `precision` */
  series: 'normal' | 'price' | 'volume'
  precision?: number
  calcParams: (number | string)[]
  figures: FigureDef[]
  minValue?: number
  maxValue?: number
  calc(dataList: BarData[], indicator: { calcParams: any[] }): IndicatorRow[]
  /** Custom canvas drawing (KLineChart `IndicatorDrawParams`); return true to skip the default figures. */
  draw?: (params: IndicatorDrawParams) => boolean
}

/** Structural subset of KLineChart 9's IndicatorDrawParams. */
export interface IndicatorDrawParams {
  ctx: CanvasRenderingContext2D
  kLineDataList: BarData[]
  indicator: { calcParams: any[]; precision: number; result: IndicatorRow[]; visible: boolean }
  visibleRange: { from: number; to: number }
  bounding: { left: number; top: number; width: number; height: number }
  barSpace: { bar: number; halfBar: number }
  xAxis: { convertToPixel(value: number): number }
  yAxis: { convertToPixel(value: number): number }
}

export function toCandles(dataList: BarData[]): Candle[] {
  return dataList.map((d) => ({ t: d.timestamp, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volume ?? 0 }))
}

/** Turn parallel series into one row object per bar; nulls become missing keys (gaps in the line). */
export function rows(length: number, series: Record<string, (number | null)[]>): IndicatorRow[] {
  const keys = Object.keys(series)
  return Array.from({ length }, (_, i) => {
    const row: IndicatorRow = {}
    for (const k of keys) {
      const v = series[k][i]
      if (v !== null && v !== undefined) row[k] = v
    }
    return row
  })
}
