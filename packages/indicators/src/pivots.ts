/** Pivot Points Standard — the TradingView "Pivots" indicator, drawn as one horizontal segment per level per period. */
import {
  autoAnchor, PIVOT_LEVELS, pivotPeriods,
  type FixedAnchor, type IndicatorDef, type PivotAnchor, type PivotLevel, type PivotType,
} from '@providence/core'
import { toCandles, type BarData, type IndicatorDrawParams, type IndicatorRow, type IndicatorTemplate } from './template'

export const PIVOT_COLOR = '#fb8c00'
const FONT = '11px -apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif'

export type PivotLabels = 'both' | 'labels' | 'prices' | 'none'

function anchorFor(anchor: PivotAnchor, dataList: BarData[]): FixedAnchor {
  if (anchor !== 'auto') return anchor
  const n = dataList.length
  const bar = n >= 2 ? dataList[n - 1].timestamp - dataList[n - 2].timestamp : 60_000
  return autoAnchor(bar)
}

/**
 * One row per bar. Rows inside a period carry the levels plus `start`/`end` (period bounds, ms) so `draw` can
 * group bars into periods; bars of periods without levels get an empty row.
 */
export function calcPivotRows(dataList: BarData[], calcParams: unknown[]): IndicatorRow[] {
  const [type, anchor, back] = calcParams as [PivotType, PivotAnchor, number]
  const rows: IndicatorRow[] = dataList.map(() => ({}))
  for (const period of pivotPeriods(toCandles(dataList), type, anchorFor(anchor, dataList), back)) {
    for (let i = period.from; i < period.to; i++) rows[i] = { ...period.levels, start: period.start, end: period.end }
  }
  return rows
}

function drawPivots({ ctx, kLineDataList, indicator, visibleRange, bounding, barSpace, xAxis, yAxis }: IndicatorDrawParams): boolean {
  const rows = indicator.result ?? []
  const labels = (indicator.calcParams[3] ?? 'both') as PivotLabels
  const width = Number(indicator.calcParams[4]) || 1
  const precision = indicator.precision
  const n = kLineDataList.length
  const bar = n >= 2 ? kLineDataList[n - 1].timestamp - kLineDataList[n - 2].timestamp : 60_000

  ctx.save()
  ctx.beginPath()
  ctx.rect(bounding.left, bounding.top, bounding.width, bounding.height)
  ctx.clip()
  ctx.setLineDash([])
  ctx.strokeStyle = PIVOT_COLOR
  ctx.fillStyle = PIVOT_COLOR
  ctx.lineWidth = width
  ctx.font = FONT
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'

  let i = Math.max(0, visibleRange.from - 1)
  // Step back to the first bar of the period that is visible at the left edge.
  while (i > 0 && rows[i]?.start !== undefined && rows[i - 1]?.start === rows[i].start) i--
  const last = Math.min(n, visibleRange.to + 1)
  while (i < last) {
    const row = rows[i]
    if (row?.start === undefined) {
      i++
      continue
    }
    let j = i
    while (j < n && rows[j]?.start === row.start) j++
    // A period that runs past the last loaded bar extends to its own end, like TradingView.
    const endIndex = j < n ? j : i + Math.max(1, Math.round((row.end! - row.start) / bar))
    const x1 = xAxis.convertToPixel(i) - barSpace.halfBar
    const x2 = xAxis.convertToPixel(endIndex) - barSpace.halfBar
    for (const key of PIVOT_LEVELS) {
      const value = row[key as PivotLevel]
      if (value === undefined || !Number.isFinite(value)) continue
      const y = Math.round(yAxis.convertToPixel(value)) + (width % 2 ? 0.5 : 0)
      ctx.beginPath()
      ctx.moveTo(x1, y)
      ctx.lineTo(x2, y)
      ctx.stroke()
      if (labels !== 'none' && x2 - x1 > 24) {
        const name = key === 'p' ? 'P' : key.toUpperCase()
        const price = value.toFixed(precision)
        const text = labels === 'both' ? `${name} (${price})` : labels === 'labels' ? name : `(${price})`
        ctx.fillText(text, x1 + 3, y - 2)
      }
    }
    i = j
  }
  ctx.restore()
  return true
}

const option = (value: string, label: string) => ({ value, label })

export const pivotsTemplate: IndicatorTemplate = {
  name: 'PV_PIVOTS',
  shortName: 'Pivots',
  series: 'price',
  calcParams: ['traditional', 'auto', 15, 'both', 1],
  // No figures: the chart library would include every level (R5/S5 are far away) in the price-axis range and squash
  // the candles. Like TradingView, the levels are drawn by `draw` and do not affect the scale.
  figures: [],
  calc: (dataList, { calcParams }) => calcPivotRows(dataList, calcParams),
  draw: drawPivots,
}

export const pivotsDef: IndicatorDef = {
  id: 'pivots',
  label: 'Pivot Points Standard',
  pane: 'overlay',
  params: {
    type: {
      type: 'select', label: 'Type', default: 'traditional',
      options: [
        option('traditional', 'Traditional'), option('fibonacci', 'Fibonacci'), option('woodie', 'Woodie'),
        option('classic', 'Classic'), option('dm', 'DM'), option('camarilla', 'Camarilla'),
      ],
    },
    anchor: {
      type: 'select', label: 'Pivots timeframe', default: 'auto',
      options: [
        option('auto', 'Auto'), option('daily', 'Daily'), option('weekly', 'Weekly'), option('monthly', 'Monthly'),
        option('quarterly', 'Quarterly'), option('yearly', 'Yearly'),
      ],
    },
    back: { type: 'number', label: 'Number of pivots back', inCaption: false, default: 15, min: 1, max: 200, step: 1 },
    labels: {
      type: 'select', label: 'Labels', inCaption: false, default: 'both',
      options: [option('both', 'Labels and prices'), option('labels', 'Labels'), option('prices', 'Prices'), option('none', 'None')],
    },
    width: { type: 'number', label: 'Line width', inCaption: false, default: 1, min: 1, max: 5, step: 1 },
  },
  template: pivotsTemplate,
}
