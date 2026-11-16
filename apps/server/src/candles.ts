/**
 * Candle service: serves `/api/bybit/candles` from the SQLite cache when it can, from Bybit otherwise.
 * Rules (market-data §4): only CLOSED candles are cached; the forming candle is never stored.
 */
import {
  candleOpenTime, closedCandles, mergeCandles, tfMs,
  type Candle, type Category, type Timeframe,
} from '@providence/core'
import type { BybitRest } from '@providence/adapter-bybit'
import type { CandleStore, KvStore } from './db'

export type FetchPlan =
  /** Everything requested is in the cache. */
  | { kind: 'cache' }
  /** Cache is good up to its newest row; fetch only what is newer (open time >= start). */
  | { kind: 'tail'; start: number }
  /** Cache cannot answer; do a normal Bybit request. */
  | { kind: 'full' }

export interface PlanInput {
  /** Cached rows, newest first, open time <= end, at most `limit` rows. */
  cached: Candle[]
  tf: Timeframe
  limit: number
  now: number
  /** Requested upper bound on open time; undefined = latest. */
  end?: number
  /** Open time of the very first candle Bybit has for this series, when known. */
  historyStart?: number
  /** Max candles Bybit returns per request. */
  maxTail?: number
}

/** Decide how to answer a candle request. Pure, so the caching rules are unit-testable. */
export function planCandleFetch(p: PlanInput): FetchPlan {
  const size = tfMs(p.tf)
  const formingOpen = candleOpenTime(p.now, p.tf)
  const lastClosedOpen = formingOpen - size
  const endOpen = p.end === undefined ? formingOpen : candleOpenTime(p.end, p.tf)
  /** Newest closed candle the answer must contain. */
  const wantNewest = Math.min(lastClosedOpen, endOpen)
  const needForming = endOpen >= formingOpen
  const { cached } = p
  if (cached.length === 0) return { kind: 'full' }

  for (let i = 0; i + 1 < cached.length; i++) {
    if (cached[i].t - cached[i + 1].t !== size) return { kind: 'full' } // hole in the cache
  }
  const newest = cached[0].t
  const oldest = cached[cached.length - 1].t
  if (newest > wantNewest) return { kind: 'full' } // clock skew / unexpected rows
  const missing = (wantNewest - newest) / size + (needForming ? 1 : 0)
  const reachesStart = p.historyStart !== undefined && oldest <= p.historyStart
  if (!reachesStart && cached.length + missing < p.limit) return { kind: 'full' }
  if (missing === 0) return { kind: 'cache' }
  if (missing > (p.maxTail ?? 1000)) return { kind: 'full' }
  return { kind: 'tail', start: newest + size }
}

export interface CandleRequest {
  category: Category
  symbol: string
  tf: Timeframe
  end?: number
  limit: number
}

export interface CandleResponse {
  candles: Candle[]
  /** Served from cache because Bybit could not be reached. */
  stale: boolean
  source: 'cache' | 'tail' | 'network'
}

export class CandleService {
  constructor(
    private readonly rest: Pick<BybitRest, 'getKline'>,
    private readonly store: CandleStore,
    private readonly meta: KvStore,
    private readonly now: () => number = Date.now,
  ) {}

  private startKey(r: CandleRequest): string {
    return `history_start:${r.category}:${r.symbol}:${r.tf}`
  }

  async get(r: CandleRequest): Promise<CandleResponse> {
    const now = this.now()
    const end = r.end ?? now
    const cached = this.store.latest(r.category, r.symbol, r.tf, end, r.limit)
    const historyStart = this.meta.get<number>(this.startKey(r))?.value
    const plan = planCandleFetch({ cached, tf: r.tf, limit: r.limit, now, end: r.end, historyStart })
    const cachedAsc = [...cached].reverse()

    if (plan.kind === 'cache') return { candles: cachedAsc, stale: false, source: 'cache' }

    try {
      if (plan.kind === 'tail') {
        const tail = await this.rest.getKline({ category: r.category, symbol: r.symbol, tf: r.tf, start: plan.start, limit: 1000 })
        const fresh = tail.filter((c) => c.t <= end)
        this.store.upsert(r.category, r.symbol, r.tf, closedCandles(fresh, r.tf, this.now()))
        return { candles: mergeCandles(cachedAsc, fresh).slice(-r.limit), stale: false, source: 'tail' }
      }
      const fetched = await this.rest.getKline({ category: r.category, symbol: r.symbol, tf: r.tf, end: r.end, limit: r.limit })
      this.store.upsert(r.category, r.symbol, r.tf, closedCandles(fetched, r.tf, this.now()))
      if (fetched.length > 0 && fetched.length < r.limit) {
        // Bybit had fewer candles than asked for: the oldest one is the start of history.
        this.meta.set(this.startKey(r), fetched[0].t)
      }
      return { candles: fetched, stale: false, source: 'network' }
    } catch (err) {
      // Bybit unreachable: serve what the cache has rather than nothing (market-data §6).
      if (cachedAsc.length > 0) return { candles: cachedAsc, stale: true, source: 'cache' }
      throw err
    }
  }
}
