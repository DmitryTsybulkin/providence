import { describe, expect, it } from 'vitest'
import type { Candle, SymbolInfo, Ticker } from '@providence/core'
import type { BybitRest, KlineParams } from '@providence/adapter-bybit'
import { buildApp } from './app'
import { CandleService, planCandleFetch } from './candles'
import { DEFAULT_CONFIG, loadConfig, resolveHost } from './config'
import { CandleStore, KvStore, openDb } from './db'
import { TtlCache } from './market'

const H = 3_600_000
const T0 = Date.UTC(2026, 0, 1) // aligned to 1h
const mk = (i: number): Candle => ({ t: T0 + i * H, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 10 })
/** newest-first rows i = from..to (inclusive) */
const desc = (from: number, to: number) => {
  const out: Candle[] = []
  for (let i = to; i >= from; i--) out.push(mk(i))
  return out
}

describe('planCandleFetch', () => {
  // now = 30 minutes into candle #100 → #100 is forming, #99 is the last closed one
  const now = T0 + 100 * H + 30 * 60_000

  it('empty cache → full fetch', () => {
    expect(planCandleFetch({ cached: [], tf: '1h', limit: 10, now })).toEqual({ kind: 'full' })
  })
  it('latest page with all closed candles cached → only the forming candle is fetched', () => {
    expect(planCandleFetch({ cached: desc(90, 99), tf: '1h', limit: 10, now })).toEqual({ kind: 'tail', start: T0 + 100 * H })
  })
  it('latest page with an older cache → fetch only the gap', () => {
    expect(planCandleFetch({ cached: desc(86, 95), tf: '1h', limit: 10, now })).toEqual({ kind: 'tail', start: T0 + 96 * H })
  })
  it('gap larger than one Bybit page → full fetch', () => {
    expect(planCandleFetch({ cached: desc(0, 9), tf: '1h', limit: 10, now, maxTail: 20 })).toEqual({ kind: 'full' })
  })
  it('paging back with the whole page cached → no network', () => {
    const end = T0 + 50 * H - 1 // "oldestLoaded.t - 1"
    expect(planCandleFetch({ cached: desc(40, 49), tf: '1h', limit: 10, now, end })).toEqual({ kind: 'cache' })
  })
  it('paging back with a partial page → full fetch', () => {
    const end = T0 + 50 * H - 1
    expect(planCandleFetch({ cached: desc(45, 49), tf: '1h', limit: 10, now, end })).toEqual({ kind: 'full' })
  })
  it('partial page that reaches the known start of history → cache', () => {
    const end = T0 + 5 * H - 1
    expect(planCandleFetch({ cached: desc(0, 4), tf: '1h', limit: 10, now, end, historyStart: T0 })).toEqual({ kind: 'cache' })
  })
  it('a hole in the cache → full fetch', () => {
    const cached = [...desc(46, 49), ...desc(40, 44)]
    expect(planCandleFetch({ cached, tf: '1h', limit: 9, now, end: T0 + 50 * H - 1 })).toEqual({ kind: 'full' })
  })
  it('page whose newest cached candle is older than requested → tail', () => {
    const end = T0 + 50 * H - 1
    expect(planCandleFetch({ cached: desc(38, 47), tf: '1h', limit: 10, now, end })).toEqual({ kind: 'tail', start: T0 + 48 * H })
  })
})

function fakeRest(series: Candle[]) {
  const calls: KlineParams[] = []
  let fail = false
  const rest: Pick<BybitRest, 'getKline'> = {
    async getKline(p) {
      calls.push(p)
      if (fail) throw new Error('bybit down')
      let rows = series
      if (p.start !== undefined) rows = rows.filter((c) => c.t >= p.start!)
      if (p.end !== undefined) rows = rows.filter((c) => c.t <= p.end!)
      return rows.slice(-(p.limit ?? 200))
    },
  }
  return { rest, calls, setFail: (v: boolean) => (fail = v) }
}

describe('CandleService', () => {
  const series = Array.from({ length: 101 }, (_, i) => mk(i)) // #100 is forming
  const setup = () => {
    const db = openDb(':memory:')
    const store = new CandleStore(db)
    const clock = { now: T0 + 100 * H + 30 * 60_000 }
    const { rest, calls, setFail } = fakeRest(series)
    const svc = new CandleService(rest, store, new KvStore(db, 'cache_meta'), () => clock.now)
    return { svc, store, calls, setFail, clock }
  }
  const req = { category: 'linear', symbol: 'BTCUSDT', tf: '1h', limit: 10 } as const

  it('never writes the forming candle to the cache', async () => {
    const { svc, store } = setup()
    const res = await svc.get(req)
    expect(res.source).toBe('network')
    expect(res.candles.map((c) => (c.t - T0) / H)).toEqual([91, 92, 93, 94, 95, 96, 97, 98, 99, 100])
    expect(store.count()).toBe(9) // #91..#99; #100 is still forming
    expect(store.latest('linear', 'BTCUSDT', '1h', Infinity, 1)[0].t).toBe(T0 + 99 * H)
  })
  it('second load comes from the cache and only asks Bybit for the forming candle', async () => {
    const { svc, calls } = setup()
    await svc.get({ ...req, limit: 11 }) // caches #90..#99
    const res = await svc.get(req)
    expect(res.source).toBe('tail')
    expect(calls[1]).toMatchObject({ start: T0 + 100 * H })
    expect(res.candles.map((c) => (c.t - T0) / H)).toEqual([91, 92, 93, 94, 95, 96, 97, 98, 99, 100])
  })
  it('paging back is served purely from the cache the second time', async () => {
    const { svc, calls } = setup()
    const end = T0 + 91 * H - 1
    const first = await svc.get({ ...req, end })
    const second = await svc.get({ ...req, end })
    expect(first.source).toBe('network')
    expect(second.source).toBe('cache')
    expect(second.candles).toEqual(first.candles)
    expect(calls).toHaveLength(1)
  })
  it('remembers the start of history so the oldest page is cacheable', async () => {
    const { svc, calls } = setup()
    const end = T0 + 5 * H - 1 // only #0..#4 exist
    const first = await svc.get({ ...req, end })
    expect(first.candles).toHaveLength(5)
    const second = await svc.get({ ...req, end })
    expect(second.source).toBe('cache')
    expect(calls).toHaveLength(1)
  })
  it('keeps spot and linear apart', async () => {
    const { svc, store } = setup()
    await svc.get(req)
    expect(store.latest('spot', 'BTCUSDT', '1h', Infinity, 10)).toHaveLength(0)
  })
  it('serves stale cache when Bybit is down, and fails when there is nothing cached', async () => {
    const { svc, setFail } = setup()
    await svc.get(req)
    setFail(true)
    const res = await svc.get(req)
    expect(res.stale).toBe(true)
    expect(res.candles).toHaveLength(9)
    await expect(svc.get({ ...req, symbol: 'ETHUSDT' })).rejects.toThrow('bybit down')
  })
  it('a candle becomes cacheable once it closes', async () => {
    const { svc, store, clock } = setup()
    await svc.get(req)
    clock.now = T0 + 101 * H + 1
    await svc.get(req)
    expect(store.latest('linear', 'BTCUSDT', '1h', Infinity, 1)[0].t).toBe(T0 + 100 * H)
  })
})

describe('TtlCache', () => {
  it('caches for the TTL, de-duplicates in-flight loads and serves stale on error', async () => {
    let now = 0
    let loads = 0
    let fail = false
    const cache = new TtlCache(5000, async () => {
      loads++
      if (fail) throw new Error('down')
      return loads
    }, () => now)
    const [a, b] = await Promise.all([cache.get(), cache.get()])
    expect([a.data, b.data, loads]).toEqual([1, 1, 1])
    now = 4999
    expect((await cache.get()).data).toBe(1)
    now = 5000
    expect(await cache.get()).toEqual({ data: 2, stale: false, fetchedAt: 5000 })
    fail = true
    now = 20_000
    expect(await cache.get()).toEqual({ data: 2, stale: true, fetchedAt: 5000 })
  })
  it('throws when there is nothing to fall back to', async () => {
    const cache = new TtlCache(1000, async () => {
      throw new Error('down')
    })
    await expect(cache.get()).rejects.toThrow('down')
  })
})

describe('HTTP routes', () => {
  const symbols: SymbolInfo[] = [{
    key: 'linear:BTCUSDT', category: 'linear', symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT',
    tickSize: 0.1, pricePrecision: 1, volumePrecision: 3, status: 'Trading',
  }]
  const tickers: Ticker[] = [{
    key: 'linear:BTCUSDT', category: 'linear', symbol: 'BTCUSDT', lastPrice: 1, change24h: 0, high24h: 1, low24h: 1,
    turnover24h: 1, volume24h: 1,
  }]
  const setup = () => {
    const counts = { symbols: 0, tickers: 0, kline: 0 }
    const rest = {
      getSymbols: async () => (counts.symbols++, symbols),
      getTickers: async () => (counts.tickers++, tickers),
      getKline: async () => (counts.kline++, [mk(0), mk(1)]),
    } as unknown as BybitRest
    const app = buildApp({ config: DEFAULT_CONFIG, db: openDb(':memory:'), rest })
    return { app, counts }
  }

  it('serves symbols and tickers through the cache', async () => {
    const { app, counts } = setup()
    const a = await app.fastify.inject('/api/bybit/symbols?category=linear')
    const b = await app.fastify.inject('/api/bybit/symbols?category=linear')
    expect(a.statusCode).toBe(200)
    expect(a.json().data).toEqual(symbols)
    expect(b.json().stale).toBe(false)
    expect(counts.symbols).toBe(1)
    await app.fastify.inject('/api/bybit/tickers?category=linear')
    await app.fastify.inject('/api/bybit/tickers?category=linear')
    expect(counts.tickers).toBe(1)
  })
  it('validates candle queries', async () => {
    const { app } = setup()
    expect((await app.fastify.inject('/api/bybit/candles?symbol=BTCUSDT&tf=2h')).statusCode).toBe(400)
    expect((await app.fastify.inject('/api/bybit/candles?symbol=BTC/USDT&tf=1h')).statusCode).toBe(400)
    expect((await app.fastify.inject('/api/bybit/candles?symbol=BTCUSDT&tf=1h&category=inverse')).statusCode).toBe(400)
    expect((await app.fastify.inject('/api/bybit/candles?symbol=BTCUSDT&tf=1h&limit=5000')).statusCode).toBe(400)
    const ok = await app.fastify.inject('/api/bybit/candles?symbol=BTCUSDT&tf=1h&limit=2')
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data).toHaveLength(2)
  })
  it('answers 502 when Bybit fails and nothing is cached', async () => {
    const rest = { getTickers: async () => { throw new Error('boom') } } as unknown as BybitRest
    const app = buildApp({ config: DEFAULT_CONFIG, db: openDb(':memory:'), rest })
    const res = await app.fastify.inject('/api/bybit/tickers')
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toBe('boom')
  })
  it('stores, reads and deletes key/value pairs', async () => {
    const { app } = setup()
    expect((await app.fastify.inject('/api/store/favourites')).json()).toEqual({ key: 'favourites', exists: false, value: null })
    const put = await app.fastify.inject({ method: 'PUT', url: '/api/store/favourites', payload: { value: ['linear:BTCUSDT'] } })
    expect(put.statusCode).toBe(200)
    const get = await app.fastify.inject('/api/store/favourites')
    expect(get.json().value).toEqual(['linear:BTCUSDT'])
    expect((await app.fastify.inject({ method: 'PUT', url: '/api/store/x', payload: {} })).statusCode).toBe(400)
    expect((await app.fastify.inject({ method: 'PUT', url: '/api/store/bad%20key', payload: { value: 1 } })).statusCode).toBe(400)
    expect((await app.fastify.inject({ method: 'DELETE', url: '/api/store/favourites' })).json().deleted).toBe(true)
    expect((await app.fastify.inject('/api/store/favourites')).json().exists).toBe(false)
  })
})

describe('config', () => {
  it('listens on loopback unless running in the Docker image', () => {
    expect(resolveHost({})).toBe('127.0.0.1')
    expect(resolveHost({ PROVIDENCE_IN_DOCKER: '0' })).toBe('127.0.0.1')
    expect(resolveHost({ PROVIDENCE_IN_DOCKER: '1' })).toBe('0.0.0.0')
  })
  it('reads environment overrides', () => {
    const c = loadConfig('/nonexistent', { PROVIDENCE_PORT: '5000', PROVIDENCE_DB_PATH: '/data/x.db', PROVIDENCE_WEB_DIR: '/app/web' })
    expect(c).toMatchObject({ port: 5000, host: '127.0.0.1', dbPath: '/data/x.db', webDir: '/app/web' })
    expect(loadConfig('/nonexistent', {})).toMatchObject({ port: 4317, dbPath: '/nonexistent/data/providence.db' })
    expect(loadConfig('/nonexistent', {}).webDir).toBeUndefined()
  })
})
