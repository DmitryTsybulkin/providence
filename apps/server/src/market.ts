/**
 * Symbols and tickers with TTL caches (market-data §3): symbols 1 h, tickers 5 s.
 * On a Bybit failure the last good value is served with `stale: true`.
 * Symbols are also persisted, so the list survives a restart without network.
 */
import type { Category, SymbolInfo, Ticker } from '@providence/core'
import type { BybitRest } from '@providence/adapter-bybit'
import type { KvStore } from './db'

export const SYMBOLS_TTL_MS = 60 * 60_000
export const TICKERS_TTL_MS = 5_000

export interface Cached<T> {
  data: T
  stale: boolean
  fetchedAt: number
}

interface Entry<T> {
  data: T
  fetchedAt: number
}

/** TTL cache with in-flight de-duplication and stale-on-error. */
export class TtlCache<T> {
  private entry: Entry<T> | undefined
  private inflight: Promise<Cached<T>> | undefined

  constructor(
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
    private readonly now: () => number = Date.now,
    private readonly persist?: { read(): Entry<T> | undefined; write(e: Entry<T>): void },
  ) {}

  async get(): Promise<Cached<T>> {
    if (!this.entry && this.persist) this.entry = this.persist.read()
    const e = this.entry
    if (e && this.now() - e.fetchedAt < this.ttlMs) return { data: e.data, stale: false, fetchedAt: e.fetchedAt }
    if (!this.inflight) {
      this.inflight = this.refresh().finally(() => {
        this.inflight = undefined
      })
    }
    return this.inflight
  }

  private async refresh(): Promise<Cached<T>> {
    try {
      const data = await this.load()
      this.entry = { data, fetchedAt: this.now() }
      this.persist?.write(this.entry)
      return { data, stale: false, fetchedAt: this.entry.fetchedAt }
    } catch (err) {
      if (this.entry) return { data: this.entry.data, stale: true, fetchedAt: this.entry.fetchedAt }
      throw err
    }
  }
}

export class MarketService {
  private readonly symbols = new Map<Category, TtlCache<SymbolInfo[]>>()
  private readonly tickers = new Map<Category, TtlCache<Ticker[]>>()

  constructor(
    private readonly rest: Pick<BybitRest, 'getSymbols' | 'getTickers'>,
    private readonly meta: KvStore,
    private readonly now: () => number = Date.now,
  ) {}

  getSymbols(category: Category): Promise<Cached<SymbolInfo[]>> {
    let cache = this.symbols.get(category)
    if (!cache) {
      const key = `symbols:${category}`
      cache = new TtlCache(SYMBOLS_TTL_MS, () => this.rest.getSymbols(category), this.now, {
        read: () => {
          const row = this.meta.get<SymbolInfo[]>(key)
          return row ? { data: row.value, fetchedAt: row.updatedAt } : undefined
        },
        write: (e) => this.meta.set(key, e.data, e.fetchedAt),
      })
      this.symbols.set(category, cache)
    }
    return cache.get()
  }

  getTickers(category: Category): Promise<Cached<Ticker[]>> {
    let cache = this.tickers.get(category)
    if (!cache) {
      cache = new TtlCache(TICKERS_TTL_MS, () => this.rest.getTickers(category), this.now)
      this.tickers.set(category, cache)
    }
    return cache.get()
  }
}
