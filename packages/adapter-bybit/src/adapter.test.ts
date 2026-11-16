import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  backoffDelay, BybitError, BybitRest, BybitWs, createBybitAdapter, gapLimit, intervalToTf, isSupportedInstrument,
  klineTopic, mapInstrument, mapKlineList, mapTicker, mapWsKline, publicWsUrl, reconnectDelay, tfToInterval,
  type WsLike,
} from './index'

// ---------- fixtures copied from live Bybit v5 responses (2026-11-16) ----------
const KLINE = {
  retCode: 0, retMsg: 'OK',
  result: {
    symbol: 'BTCUSDT', category: 'linear',
    list: [
      ['1794855600000', '65020.9', '65020.9', '64742.7', '64754', '1207.055', '78326404.3846'],
      ['1794852000000', '64879.6', '65178.8', '64679.3', '65020.9', '2885.941', '187329748.5621'],
    ],
  },
}
const LINEAR_TICKER = {
  symbol: 'BTCUSDT', lastPrice: '64763.00', prevPrice24h: '64967.50', price24hPcnt: '-0.003147',
  highPrice24h: '65683.00', lowPrice24h: '63871.00', turnover24h: '4892582849.7543', volume24h: '75600.6870',
  fundingRate: '0.0000859', nextFundingTime: '1794873600000',
}
const SPOT_TICKER = {
  symbol: 'BTCUSDT', lastPrice: '64788.6', price24hPcnt: '-0.0032', highPrice24h: '65691.2', lowPrice24h: '63906.1',
  turnover24h: '754476232.17984157', volume24h: '11653.996646',
}
const LINEAR_INSTRUMENT = {
  symbol: '0GUSDT', contractType: 'LinearPerpetual', status: 'Trading', baseCoin: '0G', quoteCoin: 'USDT',
  priceFilter: { minPrice: '0.0001', maxPrice: '1999.9998', tickSize: '0.0001' },
  lotSizeFilter: { qtyStep: '0.1' },
}
const SPOT_INSTRUMENT = {
  symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', status: 'Trading',
  lotSizeFilter: { basePrecision: '0.000001', quotePrecision: '0.0000001' }, priceFilter: { tickSize: '0.1' },
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('mapping', () => {
  it('maps timeframes to Bybit intervals and back', () => {
    expect(['1m', '5m', '15m', '1h', '4h', '1d', '1w'].map((tf) => tfToInterval(tf as never))).toEqual(
      ['1', '5', '15', '60', '240', 'D', 'W'],
    )
    expect(intervalToTf('240')).toBe('4h')
    expect(intervalToTf('3')).toBeUndefined()
  })
  it('turns newest-first string rows into oldest-first numeric candles', () => {
    const out = mapKlineList(KLINE.result.list)
    expect(out).toEqual([
      { t: 1794852000000, o: 64879.6, h: 65178.8, l: 64679.3, c: 65020.9, v: 2885.941 },
      { t: 1794855600000, o: 65020.9, h: 65020.9, l: 64742.7, c: 64754, v: 1207.055 },
    ])
  })
  it('maps instruments with precision from tick size', () => {
    expect(mapInstrument('linear', LINEAR_INSTRUMENT)).toEqual({
      key: 'linear:0GUSDT', category: 'linear', symbol: '0GUSDT', baseCoin: '0G', quoteCoin: 'USDT',
      tickSize: 0.0001, pricePrecision: 4, volumePrecision: 1, status: 'Trading',
    })
    const spot = mapInstrument('spot', SPOT_INSTRUMENT)
    expect(spot.key).toBe('spot:BTCUSDT')
    expect(spot.pricePrecision).toBe(1)
    expect(spot.volumePrecision).toBe(6)
  })
  it('keeps only USDT perpetuals in linear', () => {
    expect(isSupportedInstrument('linear', LINEAR_INSTRUMENT)).toBe(true)
    expect(isSupportedInstrument('linear', { symbol: 'BTCPERP', contractType: 'LinearPerpetual', quoteCoin: 'USDC' })).toBe(false)
    expect(isSupportedInstrument('linear', { symbol: 'BTCUSDT-27NOV26', contractType: 'LinearFutures', quoteCoin: 'USDT' })).toBe(false)
    expect(isSupportedInstrument('spot', SPOT_INSTRUMENT)).toBe(true)
  })
  it('maps tickers; funding only on linear', () => {
    const lin = mapTicker('linear', LINEAR_TICKER)
    expect(lin).toMatchObject({
      key: 'linear:BTCUSDT', lastPrice: 64763, change24h: -0.003147, turnover24h: 4892582849.7543,
      volume24h: 75600.687, fundingRate: 0.0000859, nextFundingTime: 1794873600000,
    })
    const spot = mapTicker('spot', SPOT_TICKER)
    expect(spot.key).toBe('spot:BTCUSDT')
    expect(spot.fundingRate).toBeUndefined()
  })
  it('maps WS klines and the confirm flag', () => {
    const live = mapWsKline({
      start: 1672324800000, end: 1672325099999, interval: '5', open: '16649.5', close: '16677', high: '16677',
      low: '16608', volume: '2.081', turnover: '34666.4005', confirm: false, timestamp: 1672324988882,
    })
    expect(live).toEqual({ candle: { t: 1672324800000, o: 16649.5, h: 16677, l: 16608, c: 16677, v: 2.081 }, closed: false })
  })
  it('builds topics and URLs', () => {
    expect(klineTopic('1h', 'BTCUSDT')).toBe('kline.60.BTCUSDT')
    expect(publicWsUrl('wss://stream.bybit.com/', 'spot')).toBe('wss://stream.bybit.com/v5/public/spot')
  })
})

describe('BybitRest', () => {
  const make = (responses: Array<Response | Error>) => {
    const calls: string[] = []
    const sleeps: number[] = []
    let clock = 1_000_000
    const rest = new BybitRest({
      fetch: (async (url: URL) => {
        calls.push(String(url))
        const r = responses.shift()
        if (!r) throw new Error('no more responses')
        if (r instanceof Error) throw r
        return r
      }) as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      },
      now: () => clock,
    })
    return { rest, calls, sleeps, advance: (ms: number) => (clock += ms) }
  }

  it('requests kline with the right query and maps the result', async () => {
    const { rest, calls } = make([json(KLINE)])
    const out = await rest.getKline({ category: 'linear', symbol: 'BTCUSDT', tf: '1h', end: 1794855600000, limit: 5000 })
    expect(out.map((c) => c.t)).toEqual([1794852000000, 1794855600000])
    const url = new URL(calls[0])
    expect(url.pathname).toBe('/v5/market/kline')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      category: 'linear', symbol: 'BTCUSDT', interval: '60', end: '1794855600000', limit: '1000',
    })
  })
  it('backs off exponentially on retCode 10006 and then succeeds', async () => {
    const limited = { retCode: 10006, retMsg: 'Too many visits!', result: {} }
    const { rest, calls, sleeps } = make([json(limited), json(limited), json(KLINE)])
    const out = await rest.getKline({ category: 'linear', symbol: 'BTCUSDT', tf: '1h' })
    expect(out).toHaveLength(2)
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([500, 1000])
  })
  it('backs off on HTTP 429 and gives up after max retries', async () => {
    const { rest, calls, sleeps } = make([json({}, 429), json({}, 429), json({}, 429), json({}, 429)])
    await expect(rest.getTickers('linear')).rejects.toMatchObject({ httpStatus: 429 })
    expect(calls).toHaveLength(4)
    expect(sleeps).toEqual([500, 1000, 2000])
  })
  it('does not retry other API errors', async () => {
    const { rest, calls } = make([json({ retCode: 10001, retMsg: 'params error', result: {} })])
    await expect(rest.getTickers('linear')).rejects.toBeInstanceOf(BybitError)
    expect(calls).toHaveLength(1)
  })
  it('stops calling Bybit during the cool-down after HTTP 403', async () => {
    const { rest, calls, advance } = make([json({}, 403), json({ retCode: 0, retMsg: 'OK', result: { list: [] } })])
    await expect(rest.getTickers('linear')).rejects.toMatchObject({ httpStatus: 403 })
    await expect(rest.getTickers('linear')).rejects.toMatchObject({ httpStatus: 403 })
    expect(calls).toHaveLength(1)
    advance(60_001)
    await expect(rest.getTickers('linear')).resolves.toEqual([])
    expect(calls).toHaveLength(2)
  })
  it('retries network errors', async () => {
    const { rest, calls } = make([new TypeError('fetch failed'), json({ retCode: 0, retMsg: 'OK', result: { list: [SPOT_TICKER] } })])
    const out = await rest.getTickers('spot')
    expect(out[0].symbol).toBe('BTCUSDT')
    expect(calls).toHaveLength(2)
  })
  it('follows the cursor for linear instruments and filters them', async () => {
    const page = (list: unknown[], nextPageCursor: string) => json({ retCode: 0, retMsg: 'OK', result: { list, nextPageCursor } })
    const { rest, calls } = make([
      page([LINEAR_INSTRUMENT, { symbol: 'BTCPERP', contractType: 'LinearPerpetual', quoteCoin: 'USDC' }], 'abc'),
      page([{ ...LINEAR_INSTRUMENT, symbol: 'BTCUSDT' }], ''),
    ])
    const out = await rest.getSymbols('linear')
    expect(out.map((s) => s.symbol)).toEqual(['0GUSDT', 'BTCUSDT'])
    expect(new URL(calls[1]).searchParams.get('cursor')).toBe('abc')
  })
  it('computes delays', () => {
    expect([0, 1, 2].map((a) => backoffDelay(a, 500))).toEqual([500, 1000, 2000])
    expect([0, 1, 5, 9].map((a) => reconnectDelay(a, 1000, 30_000))).toEqual([1000, 2000, 30_000, 30_000])
  })
})

// ---------- fake WebSocket ----------
class FakeSocket implements WsLike {
  static instances: FakeSocket[] = []
  readyState = 0
  sent: any[] = []
  onopen: ((ev: any) => void) | null = null
  onclose: ((ev: any) => void) | null = null
  onerror: ((ev: any) => void) | null = null
  onmessage: ((ev: { data: any }) => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  drop() {
    this.readyState = 3
    this.onclose?.({})
  }
  push(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  static get last() {
    return FakeSocket.instances[FakeSocket.instances.length - 1]
  }
}

describe('BybitWs', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.instances = []
  })
  afterEach(() => vi.useRealTimers())

  const make = () => new BybitWs({ url: 'wss://x/v5/public/linear', WebSocket: FakeSocket })

  it('connects lazily, subscribes on open and dispatches by topic', () => {
    const ws = make()
    const got: unknown[] = []
    expect(FakeSocket.instances).toHaveLength(0)
    ws.subscribe('kline.1.BTCUSDT', (m) => got.push(m.data))
    expect(ws.status).toBe('connecting')
    FakeSocket.last.open()
    expect(ws.status).toBe('open')
    expect(FakeSocket.last.sent).toEqual([{ op: 'subscribe', args: ['kline.1.BTCUSDT'] }])
    FakeSocket.last.push({ topic: 'kline.1.BTCUSDT', data: [1] })
    FakeSocket.last.push({ topic: 'kline.1.ETHUSDT', data: [2] })
    FakeSocket.last.push({ op: 'pong' })
    expect(got).toEqual([[1]])
  })
  it('subscribes new topics on the open socket and unsubscribes the last handler', () => {
    const ws = make()
    const off1 = ws.subscribe('a', () => {})
    FakeSocket.last.open()
    const off2 = ws.subscribe('b', () => {})
    const off2b = ws.subscribe('b', () => {})
    expect(FakeSocket.last.sent).toEqual([{ op: 'subscribe', args: ['a'] }, { op: 'subscribe', args: ['b'] }])
    off2()
    expect(FakeSocket.last.sent).toHaveLength(2) // still one handler on b
    off2b()
    expect(FakeSocket.last.sent[2]).toEqual({ op: 'unsubscribe', args: ['b'] })
    off1()
    expect(ws.status).toBe('open') // kept for the idle grace period
    vi.advanceTimersByTime(5000)
    expect(ws.status).toBe('idle')
    expect(FakeSocket.instances).toHaveLength(1)
  })
  it('sends a ping every 20 s', () => {
    const ws = make()
    ws.subscribe('a', () => {})
    const s = FakeSocket.last
    s.open()
    vi.advanceTimersByTime(20_000)
    s.push({ op: 'pong' })
    vi.advanceTimersByTime(20_000)
    expect(s.sent.filter((m) => m.op === 'ping')).toHaveLength(2)
  })
  it('reconnects with backoff, resubscribes all topics in chunks and reports the reconnect', () => {
    const ws = make()
    const reconnects = vi.fn()
    ws.onReconnect(reconnects)
    for (let i = 0; i < 12; i++) ws.subscribe(`t${i}`, () => {})
    const first = FakeSocket.last
    first.open()
    first.drop()
    expect(ws.status).toBe('reconnecting')
    vi.advanceTimersByTime(999)
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(2)
    // second attempt fails → next delay doubles
    FakeSocket.last.drop()
    vi.advanceTimersByTime(1999)
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(3)
    FakeSocket.last.open()
    expect(ws.status).toBe('open')
    expect(reconnects).toHaveBeenCalledTimes(1)
    const subs = FakeSocket.last.sent.filter((m) => m.op === 'subscribe')
    expect(subs.map((m) => m.args.length)).toEqual([10, 2])
    expect(subs.flatMap((m) => m.args)).toEqual(Array.from({ length: 12 }, (_, i) => `t${i}`))
  })
  it('drops a silent connection and reconnects', () => {
    const ws = make()
    ws.subscribe('a', () => {})
    FakeSocket.last.open()
    vi.advanceTimersByTime(60_000) // 3 pings, no pong, nothing received for > 45 s
    expect(ws.status).toBe('reconnecting')
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(2)
  })
})

describe('browser adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.instances = []
  })
  afterEach(() => vi.useRealTimers())

  it('computes the gap refetch size', () => {
    expect(gapLimit(0, 5 * 60_000, '1m')).toBe(7)
    expect(gapLimit(0, 10, '1h')).toBe(3)
    expect(gapLimit(0, 5000 * 60_000, '1m')).toBe(1000)
  })

  it('calls the local server, unwraps the envelope and reports status', async () => {
    const urls: string[] = []
    const adapter = createBybitAdapter({
      WebSocket: FakeSocket,
      fetch: (async (url: string) => {
        urls.push(url)
        return json({ data: [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }], stale: true, fetchedAt: 5 })
      }) as unknown as typeof fetch,
    })
    const statuses: unknown[] = []
    adapter.onRestStatus((s) => statuses.push([s.serverOk, s.stale]))
    const out = await adapter.getCandles({ symbol: 'spot:BTCUSDT', tf: '4h', to: 99, limit: 1000 })
    expect(out).toHaveLength(1)
    expect(urls[0]).toBe('/api/bybit/candles?category=spot&symbol=BTCUSDT&tf=4h&end=99&limit=1000')
    expect(statuses).toEqual([[true, true]])
  })

  it('reports an unreachable server', async () => {
    const adapter = createBybitAdapter({
      WebSocket: FakeSocket,
      fetch: (async () => {
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof fetch,
    })
    const statuses: boolean[] = []
    adapter.onRestStatus((s) => statuses.push(s.serverOk))
    await expect(adapter.getTickers('linear')).rejects.toThrow()
    expect(statuses).toEqual([false])
  })

  it('streams live candles and refetches the gap after a reconnect', async () => {
    const T0 = 1_800_000_000_000
    vi.setSystemTime(T0 + 3 * 60_000 + 5_000)
    const fetchCalls: string[] = []
    const adapter = createBybitAdapter({
      WebSocket: FakeSocket,
      fetch: (async (url: string) => {
        fetchCalls.push(url)
        const data = [0, 1, 2, 3].map((i) => ({ t: T0 + i * 60_000, o: i, h: i, l: i, c: i, v: 1 }))
        return json({ data, stale: false, fetchedAt: 0 })
      }) as unknown as typeof fetch,
    })
    const got: number[] = []
    const off = adapter.subscribeCandles('linear:BTCUSDT', '1m', (c) => got.push(c.t - T0))
    const s1 = FakeSocket.last
    expect(s1.url).toBe('wss://stream.bybit.com/v5/public/linear')
    s1.open()
    expect(s1.sent[0]).toEqual({ op: 'subscribe', args: ['kline.1.BTCUSDT'] })
    const k = (start: number) => ({ start, end: start + 59_999, interval: '1', open: '1', close: '1', high: '1', low: '1', volume: '1', turnover: '1', confirm: false, timestamp: start })
    s1.push({ topic: 'kline.1.BTCUSDT', data: [k(T0)] })
    s1.push({ topic: 'kline.1.BTCUSDT', data: [k(T0 + 60_000)] })
    expect(got).toEqual([0, 60_000])

    s1.drop()
    await vi.advanceTimersByTimeAsync(1000)
    FakeSocket.last.open()
    await vi.advanceTimersByTimeAsync(0)
    // gap refetch replays from the last seen candle onwards, oldest first
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]).toContain('limit=5')
    expect(got).toEqual([0, 60_000, 60_000, 120_000, 180_000])
    off()
  })
})
