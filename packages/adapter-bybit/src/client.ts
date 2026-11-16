/**
 * Browser-side DataAdapter for Bybit.
 * REST goes through the local Providence server (`/api/bybit/*`: proxy + cache);
 * live candles come straight from the Bybit public WebSocket, one connection per category.
 */
import {
  parseSymbolKey, tfMs, CATEGORIES,
  type Candle, type CandleQuery, type Category, type DataAdapter, type SymbolInfo, type Ticker, type Timeframe,
  type Unsubscribe,
} from '@providence/core'
import { klineTopic, mapWsKline, publicWsUrl, type BybitWsKline } from './mapping'
import { BybitWs, type WsCtor, type WsStatus } from './ws'

export interface BybitAdapterOptions {
  /** Base URL of the local server API. Default `/api`. */
  apiBase?: string
  wsHost?: string
  fetch?: typeof fetch
  WebSocket?: WsCtor
}

/** Envelope returned by the local server for Bybit-backed routes. */
export interface ApiEnvelope<T> {
  data: T
  /** True when Bybit could not be reached and cached data was served instead. */
  stale: boolean
  fetchedAt: number
}

export interface RestStatus {
  /** The local server answered */
  serverOk: boolean
  /** Data is served from cache because Bybit is unreachable */
  stale: boolean
  error?: string
  at: number
}

export type WsStatusMap = Record<Category, WsStatus>

export interface BybitAdapter extends DataAdapter {
  /** Reports the outcome of every REST call (drives the "stale / unreachable" banner). */
  onRestStatus(cb: (s: RestStatus) => void): Unsubscribe
  onWsStatus(cb: (s: WsStatusMap) => void): Unsubscribe
  getWsStatus(): WsStatusMap
}

interface CandleSub {
  category: Category
  symbolKey: string
  tf: Timeframe
  cb: (c: Candle) => void
  lastT: number | null
}

/** How many candles to refetch to cover a gap since `lastT` (plus a small overlap). */
export function gapLimit(lastT: number, now: number, tf: Timeframe, max = 1000): number {
  return Math.min(max, Math.max(2, Math.ceil((now - lastT) / tfMs(tf)) + 2))
}

export function createBybitAdapter(opts: BybitAdapterOptions = {}): BybitAdapter {
  const apiBase = (opts.apiBase ?? '/api').replace(/\/$/, '')
  const wsHost = opts.wsHost ?? 'wss://stream.bybit.com'
  const fetchImpl: typeof fetch = opts.fetch ?? ((...a) => fetch(...a))

  const restListeners = new Set<(s: RestStatus) => void>()
  const wsListeners = new Set<(s: WsStatusMap) => void>()
  const sockets = new Map<Category, BybitWs>()
  const subs = new Set<CandleSub>()

  const emitRest = (s: RestStatus) => restListeners.forEach((cb) => cb(s))
  const wsStatus = (): WsStatusMap => ({
    linear: sockets.get('linear')?.status ?? 'idle',
    spot: sockets.get('spot')?.status ?? 'idle',
  })

  async function api<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v))
    let res: Response
    try {
      res = await fetchImpl(`${apiBase}${path}?${qs.toString()}`)
    } catch (err) {
      emitRest({ serverOk: false, stale: true, error: String(err), at: Date.now() })
      throw err
    }
    if (!res.ok) {
      let message = `HTTP ${res.status}`
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) message = body.error
      } catch {
        // not JSON (e.g. dev proxy error page)
      }
      // 5xx from the proxy means the server itself is down; 502 from the server means Bybit is unreachable.
      emitRest({ serverOk: res.status === 502, stale: true, error: message, at: Date.now() })
      throw new Error(message)
    }
    const body = (await res.json()) as ApiEnvelope<T>
    emitRest({ serverOk: true, stale: body.stale, at: Date.now() })
    return body.data
  }

  function socket(category: Category): BybitWs {
    let ws = sockets.get(category)
    if (!ws) {
      ws = new BybitWs({ url: publicWsUrl(wsHost, category), WebSocket: opts.WebSocket })
      sockets.set(category, ws)
      ws.onStatus(() => wsListeners.forEach((cb) => cb(wsStatus())))
      ws.onReconnect(() => void refetchGaps(category))
    }
    return ws
  }

  /** After a reconnect, replay the candles missed while the socket was down. */
  async function refetchGaps(category: Category): Promise<void> {
    for (const sub of [...subs]) {
      if (sub.category !== category || sub.lastT === null) continue
      const from = sub.lastT
      try {
        const candles = await adapter.getCandles({
          symbol: sub.symbolKey,
          tf: sub.tf,
          limit: gapLimit(from, Date.now(), sub.tf),
        })
        if (!subs.has(sub)) continue
        for (const c of candles) {
          if (c.t < from) continue
          if (sub.lastT !== null && c.t < sub.lastT) continue
          sub.lastT = c.t
          sub.cb(c)
        }
      } catch {
        // REST failed; live updates will resume anyway and the chart reloads on a detected hole.
      }
    }
  }

  const adapter: BybitAdapter = {
    id: 'bybit',

    async listSymbols(category?: Category): Promise<SymbolInfo[]> {
      const cats = category ? [category] : [...CATEGORIES]
      const lists = await Promise.all(cats.map((c) => api<SymbolInfo[]>('/bybit/symbols', { category: c })))
      return lists.flat()
    },

    async getTickers(category?: Category): Promise<Ticker[]> {
      const cats = category ? [category] : [...CATEGORIES]
      const lists = await Promise.all(cats.map((c) => api<Ticker[]>('/bybit/tickers', { category: c })))
      return lists.flat()
    },

    getCandles(q: CandleQuery): Promise<Candle[]> {
      const { category, symbol } = parseSymbolKey(q.symbol)
      return api<Candle[]>('/bybit/candles', { category, symbol, tf: q.tf, end: q.to, limit: q.limit })
    },

    subscribeCandles(symbolKey: string, tf: Timeframe, cb: (c: Candle) => void): Unsubscribe {
      const { category, symbol } = parseSymbolKey(symbolKey)
      const sub: CandleSub = { category, symbolKey, tf, cb, lastT: null }
      subs.add(sub)
      const off = socket(category).subscribe<BybitWsKline[]>(klineTopic(tf, symbol), (msg) => {
        for (const item of msg.data) {
          const { candle } = mapWsKline(item)
          if (sub.lastT !== null && candle.t < sub.lastT) continue
          sub.lastT = candle.t
          cb(candle)
        }
      })
      return () => {
        subs.delete(sub)
        off()
      }
    },

    onRestStatus(cb) {
      restListeners.add(cb)
      return () => restListeners.delete(cb)
    },
    onWsStatus(cb) {
      wsListeners.add(cb)
      return () => wsListeners.delete(cb)
    },
    getWsStatus: wsStatus,
  }
  return adapter
}
