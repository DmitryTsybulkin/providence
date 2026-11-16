/**
 * Minimal Bybit v5 public REST client (no keys) with backoff on rate limits.
 * Rate-limit signals (https://bybit-exchange.github.io/docs/v5/rate-limit):
 *   - HTTP 429, or `retCode: 10006` ("Too many visits") in a 200 body → retry with exponential backoff
 *   - HTTP 403 "access too frequent" → IP ban; do not retry, enter a long cool-down
 */
import type { Candle, Category, SymbolInfo, Ticker, Timeframe } from '@providence/core'
import {
  mapInstruments, mapKlineList, mapTicker, tfToInterval,
  type BybitInstrument, type BybitKlineRow, type BybitTicker,
} from './mapping'

export const RET_CODE_RATE_LIMIT = 10006

export class BybitError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly retCode?: number,
  ) {
    super(message)
    this.name = 'BybitError'
  }
  get rateLimited(): boolean {
    return this.httpStatus === 429 || this.httpStatus === 403 || this.retCode === RET_CODE_RATE_LIMIT
  }
}

export interface BybitRestOptions {
  restHost?: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Retries after the first attempt on 429 / 10006 / network error. Default 3. */
  maxRetries?: number
  /** First backoff delay, doubled each retry. Default 500 ms. */
  baseDelayMs?: number
  /** Cool-down after HTTP 403. Default 60 s. */
  banCooldownMs?: number
  timeoutMs?: number
}

interface Envelope<T> {
  retCode: number
  retMsg: string
  result: T
}

export interface KlineParams {
  category: Category
  symbol: string
  tf: Timeframe
  /** Open time lower bound (ms), inclusive */
  start?: number
  /** Open time upper bound (ms), inclusive */
  end?: number
  /** 1..1000 */
  limit?: number
}

export const KLINE_MAX_LIMIT = 1000

export function backoffDelay(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** attempt
}

export class BybitRest {
  private readonly restHost: string
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly maxRetries: number
  private readonly baseDelayMs: number
  private readonly banCooldownMs: number
  private readonly timeoutMs: number
  /** Until this time every request waits (shared backoff across concurrent requests). */
  private pausedUntil = 0
  /** Until this time requests fail fast (IP ban). */
  private bannedUntil = 0

  constructor(opts: BybitRestOptions = {}) {
    this.restHost = (opts.restHost ?? 'https://api.bybit.com').replace(/\/$/, '')
    this.fetchImpl = opts.fetch ?? ((...a) => fetch(...a))
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.now = opts.now ?? Date.now
    this.maxRetries = opts.maxRetries ?? 3
    this.baseDelayMs = opts.baseDelayMs ?? 500
    this.banCooldownMs = opts.banCooldownMs ?? 60_000
    this.timeoutMs = opts.timeoutMs ?? 10_000
  }

  async request<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(this.restHost + path)
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (this.now() < this.bannedUntil) {
        throw new BybitError('Bybit temporarily blocked this IP (HTTP 403); cooling down', 403)
      }
      const wait = this.pausedUntil - this.now()
      if (wait > 0) await this.sleep(wait)
      try {
        return await this.once<T>(url)
      } catch (err) {
        lastError = err
        if (err instanceof BybitError) {
          if (err.httpStatus === 403) {
            this.bannedUntil = this.now() + this.banCooldownMs
            throw err
          }
          if (!err.rateLimited) throw err
        }
        if (attempt === this.maxRetries) break
        // Rate limit or network failure: back off, and make concurrent requests wait too.
        this.pausedUntil = Math.max(this.pausedUntil, this.now() + backoffDelay(attempt, this.baseDelayMs))
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private async once<T>(url: URL): Promise<T> {
    const res = await this.fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!res.ok) throw new BybitError(`Bybit HTTP ${res.status}`, res.status)
    const body = (await res.json()) as Envelope<T>
    if (body.retCode !== 0) {
      throw new BybitError(`Bybit ${body.retCode}: ${body.retMsg}`, res.status, body.retCode)
    }
    return body.result
  }

  /** All instruments of a category. Linear is paginated (default page 500, >500 symbols); spot is not. */
  async getSymbols(category: Category): Promise<SymbolInfo[]> {
    const all: BybitInstrument[] = []
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const result = await this.request<{ list: BybitInstrument[]; nextPageCursor?: string | null }>(
        '/v5/market/instruments-info',
        { category, limit: 1000, cursor },
      )
      all.push(...result.list)
      cursor = result.nextPageCursor || undefined
      if (!cursor || result.list.length === 0) break
    }
    return mapInstruments(category, all)
  }

  async getTickers(category: Category): Promise<Ticker[]> {
    const result = await this.request<{ list: BybitTicker[] }>('/v5/market/tickers', { category })
    return result.list.map((t) => mapTicker(category, t))
  }

  /** Oldest-first candles. May include the still-forming candle as the last item. */
  async getKline(p: KlineParams): Promise<Candle[]> {
    const result = await this.request<{ list: BybitKlineRow[] }>('/v5/market/kline', {
      category: p.category,
      symbol: p.symbol,
      interval: tfToInterval(p.tf),
      start: p.start,
      end: p.end,
      limit: Math.min(Math.max(p.limit ?? 200, 1), KLINE_MAX_LIMIT),
    })
    return mapKlineList(result.list)
  }
}
