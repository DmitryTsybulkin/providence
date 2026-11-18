/**
 * Custom indicators: plain TypeScript modules registered at startup and listed in the picker (chart.md §4).
 * To add one: write a template whose `calc` returns one row per bar, wrap it in an IndicatorDef, add it to
 * `customIndicators`. All maths comes from `@providence/core`, which the alert engine uses too.
 * Private indicators never go into this repo.
 */
import { atr, rsi, stoch, vwap, type IndicatorDef } from '@providence/core'
import { pivotsDef } from './pivots'
import { rows, toCandles, type IndicatorTemplate } from './template'

export * from './template'
export * from './pivots'

const vwapTemplate: IndicatorTemplate = {
  name: 'PV_VWAP',
  shortName: 'VWAP',
  series: 'price',
  calcParams: [],
  figures: [{ key: 'vwap', title: 'VWAP: ', type: 'line' }],
  calc: (dataList) => rows(dataList.length, { vwap: vwap(toCandles(dataList)) }),
}

const atrTemplate: IndicatorTemplate = {
  name: 'PV_ATR',
  shortName: 'ATR',
  series: 'price',
  calcParams: [14],
  figures: [{ key: 'atr', title: 'ATR: ', type: 'line' }],
  calc: (dataList, { calcParams }) => rows(dataList.length, { atr: atr(toCandles(dataList), Number(calcParams[0])) }),
}

const rsiTemplate: IndicatorTemplate = {
  name: 'PV_RSI',
  shortName: 'RSI',
  series: 'normal',
  precision: 2,
  calcParams: [14],
  figures: [{ key: 'rsi', title: 'RSI: ', type: 'line' }],
  minValue: 0,
  maxValue: 100,
  calc: (dataList, { calcParams }) =>
    rows(dataList.length, { rsi: rsi(dataList.map((d) => d.close), calcParams[0]) }),
}

const stochTemplate: IndicatorTemplate = {
  name: 'PV_STOCH',
  shortName: 'Stoch',
  series: 'normal',
  precision: 2,
  calcParams: [14, 1, 3],
  figures: [
    { key: 'k', title: '%K: ', type: 'line' },
    { key: 'd', title: '%D: ', type: 'line' },
  ],
  minValue: 0,
  maxValue: 100,
  calc: (dataList, { calcParams }) => {
    const { k, d } = stoch(toCandles(dataList), calcParams[0], calcParams[1], calcParams[2])
    return rows(dataList.length, { k, d })
  },
}

export const customIndicators: IndicatorDef[] = [
  pivotsDef,
  { id: 'vwap', label: 'VWAP', pane: 'overlay', params: {}, template: vwapTemplate },
  {
    id: 'rsi',
    label: 'RSI',
    pane: 'separate',
    params: { length: { type: 'number', label: 'Length', default: 14, min: 2, max: 500, step: 1 } },
    template: rsiTemplate,
  },
  {
    id: 'stoch',
    label: 'Stochastic',
    pane: 'separate',
    params: {
      length: { type: 'number', label: 'Length', default: 14, min: 1, max: 500, step: 1 },
      smoothK: { type: 'number', label: '%K smoothing', default: 1, min: 1, max: 100, step: 1 },
      smoothD: { type: 'number', label: '%D smoothing', default: 3, min: 1, max: 100, step: 1 },
    },
    template: stochTemplate,
  },
  {
    id: 'atr',
    label: 'ATR',
    pane: 'separate',
    params: { length: { type: 'number', label: 'Length', default: 14, min: 1, max: 500, step: 1 } },
    template: atrTemplate,
  },
]
