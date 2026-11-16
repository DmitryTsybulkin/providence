import type { FC } from 'react'

// ---------- Shared models ----------

/** One OHLCV bar. `t` is the open time in ms (UTC). */
export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

export const CATEGORIES = ['linear', 'spot'] as const
export type Category = (typeof CATEGORIES)[number]

/**
 * A symbol key is `category:symbol`, e.g. `linear:BTCUSDT`.
 * Spot and linear share names, so the category is always part of the key.
 */
export type SymbolKey = `${Category}:${string}`

export interface SymbolInfo {
  key: SymbolKey
  category: Category
  symbol: string
  baseCoin: string
  quoteCoin: string
  /** Smallest price step, e.g. 0.1 */
  tickSize: number
  /** Number of decimals in a price */
  pricePrecision: number
  /** Number of decimals in a quantity */
  volumePrecision: number
  status: string
}

export interface Ticker {
  key: SymbolKey
  category: Category
  symbol: string
  lastPrice: number
  /** 24h change as a fraction: 0.0123 = +1.23 % */
  change24h: number
  high24h: number
  low24h: number
  /** 24h turnover in quote coin */
  turnover24h: number
  /** 24h volume in base coin */
  volume24h: number
  /** Funding rate as a fraction; linear only */
  fundingRate?: number
  nextFundingTime?: number
}

export type Unsubscribe = () => void

// ---------- Extension points (architecture §4) ----------

export interface CandleQuery {
  /** Symbol key, `category:symbol` */
  symbol: string
  tf: Timeframe
  /** Return candles with open time <= `to` (ms). Omit for the latest. */
  to?: number
  limit: number
}

/** Market data source. */
export interface DataAdapter {
  id: string
  listSymbols(category?: Category): Promise<SymbolInfo[]>
  /** Oldest-first. The last item may be the still-forming candle when `to` is omitted. */
  getCandles(q: CandleQuery): Promise<Candle[]>
  subscribeCandles(symbol: string, tf: Timeframe, cb: (c: Candle) => void): Unsubscribe
  getTickers(category?: Category): Promise<Ticker[]>
}

export interface NumberParam {
  type: 'number'
  label: string
  default: number
  min?: number
  max?: number
  step?: number
}
/** Ordered map of parameter name → definition. Order defines `calcParams` order. */
export type ParamSchema = Record<string, NumberParam>
export type ParamValues = Record<string, number | string>

export interface IndicatorDef {
  id: string
  /** Display name, e.g. "RSI" */
  label: string
  pane: 'overlay' | 'separate'
  params: ParamSchema
  /** Chart-library indicator template (KLineChart IndicatorTemplate). Absent = built into the chart library. */
  template?: unknown
}

export type DrawingGroup = 'lines' | 'channels' | 'fib' | 'forecast' | 'annotate'

export interface DrawingTool {
  id: string
  label: string
  group: DrawingGroup
  /** Chart-library overlay template (KLineChart OverlayTemplate). Absent = built-in. */
  template?: unknown
}

export interface Panel {
  id: string
  title: string
  component: FC
}

export interface AlertChannel {
  /** "in-app", "os", later "telegram" */
  id: string
  send(a: FiredAlert): Promise<void>
}

// ---------- Chart state ----------

export interface DrawingPoint {
  timestamp: number
  value: number
}

/** A drawing stored in data coordinates, so it survives zoom, scroll and TF switch. */
export interface DrawingShape {
  id: string
  /** Overlay name, e.g. "segment", "longPosition" */
  name: string
  points: DrawingPoint[]
  styles?: Record<string, unknown>
  extendData?: unknown
  lock?: boolean
  visible?: boolean
}

export interface IndicatorState {
  id: string
  params: ParamValues
  visible: boolean
}

/**
 * Saved per layout cell. Drawings are NOT part of the cell state: they are stored
 * per symbol under `drawings:<category>:<symbol>` (drawings.md §3).
 */
export interface ChartState {
  symbol: string
  category: Category
  tf: Timeframe
  indicators: IndicatorState[]
}

// ---------- Alerts ----------

export type AlertCondition = 'cross' | 'above' | 'below'
export type AlertTrigger = 'once' | 'every'
export type AlertStatus = 'active' | 'paused' | 'triggered' | 'expired'
export type LineKind = 'horizontal' | 'segment' | 'ray' | 'straight'

export interface AlertLine {
  drawingId: string
  kind: LineKind
  points: DrawingPoint[]
}

export interface AlertIndicator {
  /** One of ALERT_INDICATORS */
  id: string
  length: number
  tf: Timeframe
}

interface AlertBase {
  id: string
  category: Category
  symbol: string
  condition: AlertCondition
  trigger: AlertTrigger
  status: AlertStatus
  note?: string
  /** ms; alert becomes `expired` after this time */
  expiresAt?: number
  createdAt: number
  /** Dedup marker: open time of the candle (or 1m bucket) the alert last fired in */
  lastFiredCandle?: number
}
export interface PriceAlert extends AlertBase {
  type: 'price'
  value: number
}
export interface LineAlert extends AlertBase {
  type: 'line'
  line: AlertLine
}
export interface IndicatorAlert extends AlertBase {
  type: 'indicator'
  indicator: AlertIndicator
  value: number
}
export type Alert = PriceAlert | LineAlert | IndicatorAlert

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never
export type AlertInput = DistributiveOmit<Alert, 'id' | 'status' | 'createdAt' | 'lastFiredCandle'>

export interface FiredAlert {
  id: string
  alertId: string
  category: Category
  symbol: string
  firedAt: number
  /** Price at the moment of firing */
  price: number
  /** Observed value that satisfied the condition (price or indicator value) */
  value: number
  /** Threshold it was compared against */
  threshold: number
  message: string
}

/** Messages pushed server → web over the `/events` WebSocket. */
export type ServerEvent =
  | { type: 'hello'; time: number }
  | { type: 'alert-fired'; fired: FiredAlert; alert: Alert }
  | { type: 'alerts-changed' }
