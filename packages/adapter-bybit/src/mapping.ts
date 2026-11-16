/**
 * Pure mapping between Bybit v5 payloads and Providence models.
 * Field names verified against https://bybit-exchange.github.io/docs/v5/market/kline,
 * /market/instrument, /market/tickers, /websocket/public/kline and /websocket/public/ticker.
 */
import {
  decimalsOf, symbolKey, TIMEFRAMES,
  type Candle, type Category, type SymbolInfo, type Ticker, type Timeframe,
} from '@providence/core'

/** Timeframe → Bybit kline interval (market-data §4). */
export const TF_TO_INTERVAL: Record<Timeframe, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
}

export function tfToInterval(tf: Timeframe): string {
  return TF_TO_INTERVAL[tf]
}

export function intervalToTf(interval: string): Timeframe | undefined {
  return TIMEFRAMES.find((tf) => TF_TO_INTERVAL[tf] === interval)
}

function num(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** REST kline row: [startTime, open, high, low, close, volume, turnover], all strings. */
export type BybitKlineRow = string[]

export function mapKlineRow(row: BybitKlineRow): Candle {
  return { t: num(row[0]), o: num(row[1]), h: num(row[2]), l: num(row[3]), c: num(row[4]), v: num(row[5]) }
}

/** Bybit returns candles newest-first as strings → oldest-first numbers. */
export function mapKlineList(list: BybitKlineRow[]): Candle[] {
  const out = list.map(mapKlineRow)
  out.sort((a, b) => a.t - b.t)
  return out
}

/** Subset of the instruments-info item we read. */
export interface BybitInstrument {
  symbol: string
  status?: string
  baseCoin?: string
  quoteCoin?: string
  contractType?: string
  priceFilter?: { tickSize?: string }
  lotSizeFilter?: { qtyStep?: string; basePrecision?: string }
}

/**
 * Scope (market-data §2): `linear` = USDT perpetuals only. Bybit's `linear` category also
 * contains USDC perpetuals and dated futures, which are dropped here.
 */
export function isSupportedInstrument(category: Category, i: BybitInstrument): boolean {
  if (category === 'linear') return i.contractType === 'LinearPerpetual' && i.quoteCoin === 'USDT'
  return true
}

export function mapInstrument(category: Category, i: BybitInstrument): SymbolInfo {
  const tickSize = num(i.priceFilter?.tickSize, 0.01)
  const qtyStep = num(category === 'spot' ? i.lotSizeFilter?.basePrecision : i.lotSizeFilter?.qtyStep, 0.001)
  return {
    key: symbolKey(category, i.symbol),
    category,
    symbol: i.symbol,
    baseCoin: i.baseCoin ?? '',
    quoteCoin: i.quoteCoin ?? '',
    tickSize,
    pricePrecision: decimalsOf(tickSize),
    volumePrecision: Math.min(decimalsOf(qtyStep), 8),
    status: i.status ?? '',
  }
}

export function mapInstruments(category: Category, list: BybitInstrument[]): SymbolInfo[] {
  return list.filter((i) => isSupportedInstrument(category, i)).map((i) => mapInstrument(category, i))
}

export interface BybitTicker {
  symbol: string
  lastPrice?: string
  price24hPcnt?: string
  highPrice24h?: string
  lowPrice24h?: string
  turnover24h?: string
  volume24h?: string
  fundingRate?: string
  nextFundingTime?: string
}

export function mapTicker(category: Category, t: BybitTicker): Ticker {
  const out: Ticker = {
    key: symbolKey(category, t.symbol),
    category,
    symbol: t.symbol,
    lastPrice: num(t.lastPrice),
    change24h: num(t.price24hPcnt),
    high24h: num(t.highPrice24h),
    low24h: num(t.lowPrice24h),
    turnover24h: num(t.turnover24h),
    volume24h: num(t.volume24h),
  }
  if (category === 'linear' && t.fundingRate !== undefined && t.fundingRate !== '') {
    out.fundingRate = num(t.fundingRate)
    out.nextFundingTime = num(t.nextFundingTime)
  }
  return out
}

/** WS `kline.{interval}.{symbol}` data item. */
export interface BybitWsKline {
  start: number
  end: number
  interval: string
  open: string
  close: string
  high: string
  low: string
  volume: string
  turnover: string
  confirm: boolean
  timestamp: number
}

export interface LiveCandle {
  candle: Candle
  /** `confirm=true`: the candle has closed */
  closed: boolean
}

export function mapWsKline(k: BybitWsKline): LiveCandle {
  return {
    candle: { t: num(k.start), o: num(k.open), h: num(k.high), l: num(k.low), c: num(k.close), v: num(k.volume) },
    closed: k.confirm === true,
  }
}

export function klineTopic(tf: Timeframe, symbol: string): string {
  return `kline.${TF_TO_INTERVAL[tf]}.${symbol}`
}

export function tickerTopic(symbol: string): string {
  return `tickers.${symbol}`
}

export function publicWsUrl(wsHost: string, category: Category): string {
  return `${wsHost.replace(/\/$/, '')}/v5/public/${category}`
}
