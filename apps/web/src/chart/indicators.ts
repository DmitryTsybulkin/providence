/**
 * Indicator registry: built-in KLineChart indicators mapped to IndicatorDefs, plus the custom
 * indicators from `@providence/indicators`, registered with the chart library on first use.
 *
 * Built-ins of klinecharts 9.8.12 (getSupportedIndicators()): AVP AO BIAS BOLL BRAR BBI CCI CR DMA DMI EMV EMA
 * MTM MA MACD OBV PVT PSY ROC RSI SMA KDJ SAR TRIX VOL VR WR. There is no ATR and no session VWAP, and the
 * built-in RSI is the simple-average variant, so VWAP, ATR, RSI (Wilder) and Stochastic are custom.
 */
import { registerIndicator, type IndicatorTemplate as KLineIndicatorTemplate } from 'klinecharts'
import { paramList, resolveParams, type IndicatorDef, type ParamValues } from '@providence/core'
import { customIndicators, type IndicatorTemplate } from '@providence/indicators'

interface BuiltinSpec {
  /** KLineChart indicator name */
  name: string
  /** Map resolved params to calcParams. Default: schema order. */
  calcParams?: (p: Record<string, number>) => number[]
  /** Extra decimals relative to the price precision; undefined = library default */
  precisionOffset?: number
}

const lengths = (p: Record<string, number>) => Object.values(p).filter((v) => v > 0)
const len = (label: string, def: number) => ({ type: 'number' as const, label, default: def, min: 0, max: 1000, step: 1 })

const BUILTIN_DEFS: IndicatorDef[] = [
  { id: 'sma', label: 'SMA', pane: 'overlay', params: { length1: len('Length 1', 20), length2: len('Length 2', 50), length3: len('Length 3', 200) } },
  { id: 'ema', label: 'EMA', pane: 'overlay', params: { length1: len('Length 1', 9), length2: len('Length 2', 21), length3: len('Length 3', 50) } },
  {
    id: 'bb',
    label: 'Bollinger Bands',
    pane: 'overlay',
    params: {
      length: { type: 'number', label: 'Length', default: 20, min: 2, max: 1000, step: 1 },
      mult: { type: 'number', label: 'Multiplier', default: 2, min: 0.1, max: 10, step: 0.1 },
    },
  },
  {
    id: 'sar',
    label: 'Parabolic SAR',
    pane: 'overlay',
    params: {
      start: { type: 'number', label: 'Start (%)', default: 2, min: 1, max: 50, step: 1 },
      step: { type: 'number', label: 'Step (%)', default: 2, min: 1, max: 50, step: 1 },
      max: { type: 'number', label: 'Max (%)', default: 20, min: 1, max: 100, step: 1 },
    },
  },
  { id: 'volume', label: 'Volume', pane: 'separate', params: { ma: len('MA length', 20) } },
  {
    id: 'macd',
    label: 'MACD',
    pane: 'separate',
    params: {
      fast: { type: 'number', label: 'Fast', default: 12, min: 1, max: 500, step: 1 },
      slow: { type: 'number', label: 'Slow', default: 26, min: 1, max: 500, step: 1 },
      signal: { type: 'number', label: 'Signal', default: 9, min: 1, max: 500, step: 1 },
    },
  },
  { id: 'cci', label: 'CCI', pane: 'separate', params: { length: { type: 'number', label: 'Length', default: 20, min: 2, max: 500, step: 1 } } },
  { id: 'obv', label: 'OBV', pane: 'separate', params: { ma: { type: 'number', label: 'MA length', default: 30, min: 1, max: 500, step: 1 } } },
]

const BUILTIN_SPECS: Record<string, BuiltinSpec> = {
  sma: { name: 'MA', calcParams: lengths },
  ema: { name: 'EMA', calcParams: lengths },
  bb: { name: 'BOLL' },
  volume: { name: 'VOL', calcParams: lengths },
  macd: { name: 'MACD', precisionOffset: 1 },
  sar: { name: 'SAR' },
  cci: { name: 'CCI' },
  obv: { name: 'OBV' },
}

const ALL_DEFS: IndicatorDef[] = [...BUILTIN_DEFS, ...customIndicators]
const DEF_BY_ID = new Map(ALL_DEFS.map((d) => [d.id, d]))

let registered = false
export function ensureIndicatorsRegistered(): void {
  if (registered) return
  registered = true
  for (const def of customIndicators) {
    registerIndicator(def.template as unknown as KLineIndicatorTemplate)
  }
}

/** Every indicator the picker can offer, built-in first. */
export function listIndicatorDefs(): IndicatorDef[] {
  return ALL_DEFS
}

export function getIndicatorDef(id: string): IndicatorDef | undefined {
  return DEF_BY_ID.get(id)
}

export interface KLineIndicatorSpec {
  name: string
  calcParams: number[]
  precision?: number
}

/** Translate an indicator + user params into what KLineChart's createIndicator needs. */
export function toKLineSpec(def: IndicatorDef, params: ParamValues, pricePrecision: number): KLineIndicatorSpec {
  const builtin = BUILTIN_SPECS[def.id]
  if (builtin) {
    const resolved = resolveParams(def.params, params)
    return {
      name: builtin.name,
      calcParams: builtin.calcParams ? builtin.calcParams(resolved) : Object.values(resolved),
      ...(builtin.precisionOffset !== undefined ? { precision: pricePrecision + builtin.precisionOffset } : {}),
    }
  }
  const template = def.template as IndicatorTemplate
  return { name: template.name, calcParams: paramList(def.params, params) }
}

/** Short legend text such as "EMA 9 21 50". */
export function indicatorCaption(def: IndicatorDef, params: ParamValues): string {
  const values = Object.values(resolveParams(def.params, params)).filter((v) => v > 0)
  return values.length ? `${def.label} ${values.join(' ')}` : def.label
}
