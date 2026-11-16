import { describe, expect, it } from 'vitest'
import { rsi, type Alert, type AlertChannel, type AlertInput, type Candle, type FiredAlert } from '@providence/core'
import type { BybitRest } from '@providence/adapter-bybit'
import { buildApp } from '../app'
import { DEFAULT_CONFIG } from '../config'
import { openDb } from '../db'
import { appleScriptString } from './channels'
import { AlertEngine, alertMessage, indicatorHistory, type CandleLoader } from './engine'
import type { MarketFeed } from './feed'
import { AlertStore } from './store'
import { parseAlertInput } from './validate'

const MIN = 60_000
const H = 3_600_000
const T0 = Date.UTC(2026, 0, 1)

function fakeFeed() {
  const active = new Set<string>()
  const log: string[] = []
  const track = (key: string) => {
    active.add(key)
    log.push(`+${key}`)
    return () => {
      active.delete(key)
      log.push(`-${key}`)
    }
  }
  const feed: MarketFeed = {
    subscribePrice: (c, s) => track(`price:${c}:${s}`),
    subscribeClosedCandle: (c, s, tf) => track(`kline:${c}:${s}:${tf}`),
    close() {},
  }
  return { feed, active, log }
}

function setup(loadCandles: CandleLoader = async () => []) {
  const db = openDb(':memory:')
  const store = new AlertStore(db)
  const fired: FiredAlert[] = []
  const channel: AlertChannel = { id: 'test', send: async (f) => void fired.push(f) }
  const clock = { now: T0 }
  const f = fakeFeed()
  let changes = 0
  const make = () =>
    new AlertEngine({ store, feed: f.feed, loadCandles, channels: [channel], now: () => clock.now, onChange: () => changes++ })
  const engine = make()
  engine.start()
  return { engine, store, fired, clock, ...f, restart: () => { const e = make(); e.start(); return e }, changes: () => changes }
}

const price = (over: Partial<AlertInput> = {}): AlertInput =>
  ({ type: 'price', category: 'linear', symbol: 'BTCUSDT', condition: 'cross', trigger: 'once', value: 100, ...over }) as AlertInput

describe('price alerts', () => {
  it('fires once when the price crosses the level, then becomes triggered', () => {
    const s = setup()
    const a = s.engine.create(price())
    expect([...s.active]).toEqual(['price:linear:BTCUSDT'])
    s.engine.onPrice('linear', 'BTCUSDT', 99, T0)
    s.engine.onPrice('linear', 'BTCUSDT', 99.5, T0 + 1000)
    expect(s.fired).toHaveLength(0)
    s.engine.onPrice('linear', 'BTCUSDT', 100.5, T0 + 2000)
    expect(s.fired).toHaveLength(1)
    expect(s.fired[0]).toMatchObject({ alertId: a.id, price: 100.5, threshold: 100, symbol: 'BTCUSDT' })
    expect(s.engine.list()[0].status).toBe('triggered')
    expect(s.store.history()).toHaveLength(1)
    expect(s.active.size).toBe(0) // nothing left to watch
    s.engine.onPrice('linear', 'BTCUSDT', 99, T0 + 3000)
    expect(s.fired).toHaveLength(1)
  })
  it('"every time" fires on each cross but at most once per minute', () => {
    const s = setup()
    s.engine.create(price({ trigger: 'every' }))
    const tick = (p: number, t: number) => s.engine.onPrice('linear', 'BTCUSDT', p, T0 + t)
    tick(99, 0)
    tick(101, 1000) // cross up → fire
    tick(99, 2000) // cross down in the same minute → suppressed
    tick(101, 3000)
    expect(s.fired).toHaveLength(1)
    tick(99, MIN + 1000) // next minute → fire
    expect(s.fired).toHaveLength(2)
    expect(s.engine.list()[0].status).toBe('active')
  })
  it('above / below are edge-triggered and fire immediately when already in the zone', () => {
    const s = setup()
    s.engine.create(price({ condition: 'above', trigger: 'every' }))
    s.engine.create(price({ condition: 'below', value: 50, trigger: 'every' }))
    s.engine.onPrice('linear', 'BTCUSDT', 120, T0)
    expect(s.fired.map((f) => f.threshold)).toEqual([100])
    s.engine.onPrice('linear', 'BTCUSDT', 130, T0 + 5 * MIN) // still above → no new fire
    expect(s.fired).toHaveLength(1)
    s.engine.onPrice('linear', 'BTCUSDT', 40, T0 + 6 * MIN)
    expect(s.fired.map((f) => f.threshold)).toEqual([100, 50])
  })
  it('ignores other symbols and categories', () => {
    const s = setup()
    s.engine.create(price())
    s.engine.onPrice('spot', 'BTCUSDT', 99, T0)
    s.engine.onPrice('spot', 'BTCUSDT', 101, T0 + 1)
    s.engine.onPrice('linear', 'ETHUSDT', 99, T0)
    s.engine.onPrice('linear', 'ETHUSDT', 101, T0 + 1)
    expect(s.fired).toHaveLength(0)
  })
  it('does not fire again after a restart while the condition simply still holds', () => {
    const s = setup()
    s.engine.create(price({ condition: 'above', trigger: 'every' }))
    s.engine.onPrice('linear', 'BTCUSDT', 120, T0)
    expect(s.fired).toHaveLength(1)
    const again = s.restart() // loses in-memory state, keeps the stored dedup marker
    again.onPrice('linear', 'BTCUSDT', 121, T0 + 10 * MIN)
    expect(s.fired).toHaveLength(1)
    again.onPrice('linear', 'BTCUSDT', 90, T0 + 11 * MIN)
    again.onPrice('linear', 'BTCUSDT', 121, T0 + 12 * MIN) // left and re-entered → fires
    expect(s.fired).toHaveLength(2)
  })
  it('pausing stops evaluation; resuming re-arms; deleting unsubscribes', () => {
    const s = setup()
    const a = s.engine.create(price())
    s.engine.setStatus(a.id, 'paused')
    expect(s.active.size).toBe(0)
    s.engine.onPrice('linear', 'BTCUSDT', 99, T0)
    s.engine.onPrice('linear', 'BTCUSDT', 101, T0 + 1)
    expect(s.fired).toHaveLength(0)
    s.engine.setStatus(a.id, 'active')
    s.engine.onPrice('linear', 'BTCUSDT', 101, T0 + 2) // first observation after re-arm
    s.engine.onPrice('linear', 'BTCUSDT', 99, T0 + 3)
    expect(s.fired).toHaveLength(1)
    expect(s.engine.remove(a.id)).toBe(true)
    expect(s.engine.list()).toHaveLength(0)
    expect(s.store.list()).toHaveLength(0)
  })
  it('expires', () => {
    const s = setup()
    s.engine.create(price({ expiresAt: T0 + MIN }))
    s.clock.now = T0 + 2 * MIN
    s.engine.onPrice('linear', 'BTCUSDT', 99, s.clock.now)
    s.engine.onPrice('linear', 'BTCUSDT', 101, s.clock.now + 1)
    expect(s.fired).toHaveLength(0)
    expect(s.restart().list()[0].status).toBe('expired')
  })
})

describe('line alerts', () => {
  const line = (over: Partial<AlertInput> = {}): AlertInput =>
    ({
      type: 'line', category: 'linear', symbol: 'BTCUSDT', condition: 'cross', trigger: 'once',
      line: { drawingId: 'd1', kind: 'segment', points: [{ timestamp: T0, value: 100 }, { timestamp: T0 + 10 * H, value: 200 }] },
      ...over,
    }) as AlertInput

  it('fires when the price crosses a sloped trend line', () => {
    const s = setup()
    s.engine.create(line())
    s.engine.onPrice('linear', 'BTCUSDT', 160, T0 + 5 * H) // line = 150, price above
    s.engine.onPrice('linear', 'BTCUSDT', 158, T0 + 5 * H + MIN)
    expect(s.fired).toHaveLength(0)
    s.engine.onPrice('linear', 'BTCUSDT', 149, T0 + 5 * H + 2 * MIN) // line ≈ 150.33
    expect(s.fired).toHaveLength(1)
    expect(s.fired[0].threshold).toBeCloseTo(150.33, 1)
  })
  it('fires when a rising line overtakes a flat price', () => {
    const s = setup()
    s.engine.create(line())
    s.engine.onPrice('linear', 'BTCUSDT', 150.5, T0 + 5 * H) // line 150 < price
    s.engine.onPrice('linear', 'BTCUSDT', 150.5, T0 + 5 * H + 10 * MIN) // line 151.67 > price
    expect(s.fired).toHaveLength(1)
  })
  it('is inactive outside a segment and does not treat re-entry as a cross', () => {
    const s = setup()
    s.engine.create(line())
    s.engine.onPrice('linear', 'BTCUSDT', 500, T0 + 11 * H)
    s.engine.onPrice('linear', 'BTCUSDT', 10, T0 + 12 * H)
    expect(s.fired).toHaveLength(0)
  })
  it('follows the drawing when it moves and pauses when it is deleted', () => {
    const s = setup()
    const a = s.engine.create(line())
    s.engine.onPrice('linear', 'BTCUSDT', 160, T0 + 5 * H)
    // the user drags the line far above the price: must not count as a cross
    const moved = { drawingId: 'd1', kind: 'horizontal' as const, points: [{ timestamp: T0, value: 300 }] }
    expect(s.engine.syncLines('linear', 'BTCUSDT', [moved])).toBe(1)
    s.engine.onPrice('linear', 'BTCUSDT', 161, T0 + 5 * H + MIN)
    expect(s.fired).toHaveLength(0)
    s.engine.onPrice('linear', 'BTCUSDT', 301, T0 + 5 * H + 2 * MIN)
    expect(s.fired).toHaveLength(1)

    const b = s.engine.create(line({ line: { drawingId: 'd2', kind: 'horizontal', points: [{ timestamp: T0, value: 50 }] } } as never))
    expect(s.engine.syncLines('linear', 'BTCUSDT', [moved])).toBe(1) // d2 no longer exists
    expect(s.engine.list().find((x) => x.id === b.id)!.status).toBe('paused')
    expect(s.engine.syncLines('linear', 'ETHUSDT', [])).toBe(0)
    expect(a.id).not.toBe(b.id)
  })
})

describe('indicator alerts', () => {
  // closes that push RSI(14) from below 70 to above 70 on the last candle
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 45.9, 46.9]
  const candles: Candle[] = closes.map((c, i) => ({ t: T0 + i * H, o: c, h: c, l: c, c, v: 1 }))
  const last = candles[candles.length - 1]
  const reference = rsi(closes, 14)
  const input = (over: Partial<AlertInput> = {}): AlertInput =>
    ({
      type: 'indicator', category: 'linear', symbol: 'BTCUSDT', condition: 'above', trigger: 'every', value: 70,
      indicator: { id: 'rsi', length: 14, tf: '1h' }, ...over,
    }) as AlertInput

  it('fires on candle close, once per candle, with the shared RSI maths', async () => {
    const requests: unknown[] = []
    const s = setup(async (q) => {
      requests.push(q)
      return candles.filter((c) => c.t <= q.end)
    })
    s.engine.create(input())
    expect([...s.active]).toEqual(['kline:linear:BTCUSDT:1h'])
    expect(reference[14]!).toBeGreaterThan(70)

    await s.engine.onClosedCandle('linear', 'BTCUSDT', '1h', last)
    expect(s.fired).toHaveLength(1)
    expect(s.fired[0].value).toBe(reference[14])
    expect(requests[0]).toEqual({ category: 'linear', symbol: 'BTCUSDT', tf: '1h', end: last.t, limit: 300 })

    // the same closed candle delivered again (e.g. after a WS reconnect) → no duplicate
    await s.engine.onClosedCandle('linear', 'BTCUSDT', '1h', last)
    expect(s.fired).toHaveLength(1)
    expect(requests).toHaveLength(1)
  })
  it('"every time" + above fires at each close while the level holds, once per candle', async () => {
    const more = [...candles, { t: last.t + H, o: 47.5, h: 47.5, l: 47.5, c: 47.5, v: 1 }]
    const s = setup(async (q) => more.filter((c) => c.t <= q.end))
    s.engine.create(input())
    await s.engine.onClosedCandle('linear', 'BTCUSDT', '1h', last)
    await s.engine.onClosedCandle('linear', 'BTCUSDT', '1h', more[more.length - 1])
    await s.engine.onClosedCandle('linear', 'BTCUSDT', '1h', more[more.length - 1])
    expect(s.fired).toHaveLength(2)
  })
  it('cross needs the previous candle on the other side', async () => {
    const up = (i: number, c: number): Candle => ({ t: last.t + i * H, o: c, h: c, l: c, c, v: 1 })
    const more = [...candles, up(1, 47.5), up(2, 48.5)]
    const r = rsi(more.map((c) => c.c), 14)
    const level = ((r[14] as number) + (r[15] as number)) / 2 // between candle #14 and #15, both rising
    expect(r[16]!).toBeGreaterThan(r[15]!)
    const s = setup(async (q) => more.filter((c) => c.t <= q.end))
    s.engine.create(input({ condition: 'cross', value: level }))
    await s.engine.onClosedCandle('linear', 'BTCUSDT', '1h', more[14]) // no previous RSI value yet
    expect(s.fired).toHaveLength(0)
    await s.engine.onClosedCandle('linear', 'BTCUSDT', '1h', more[15]) // crosses the level
    await s.engine.onClosedCandle('linear', 'BTCUSDT', '1h', more[16]) // stays above: no cross
    expect(s.fired).toHaveLength(1)
    expect(s.fired[0].value).toBe(r[15])
  })
  it('does not fire when the condition is not met or the timeframe differs', async () => {
    const s = setup(async (q) => candles.filter((c) => c.t <= q.end))
    s.engine.create(input({ condition: 'below', value: 30 }))
    await s.engine.onClosedCandle('linear', 'BTCUSDT', '1h', last)
    await s.engine.onClosedCandle('linear', 'BTCUSDT', '4h', last)
    expect(s.fired).toHaveLength(0)
  })
  it('survives a candle-loading failure', async () => {
    const s = setup(async () => {
      throw new Error('bybit down')
    })
    s.engine.create(input())
    await expect(s.engine.onClosedCandle('linear', 'BTCUSDT', '1h', last)).resolves.toBeUndefined()
    expect(s.fired).toHaveLength(0)
  })
  it('asks for enough history', () => {
    expect(indicatorHistory(14)).toBe(300)
    expect(indicatorHistory(50)).toBe(500)
    expect(indicatorHistory(500)).toBe(1000)
  })
})

describe('messages and validation', () => {
  it('builds readable messages', () => {
    const base = { id: 'a', status: 'active', createdAt: 0, category: 'linear', symbol: 'BTCUSDT', trigger: 'once' } as const
    expect(alertMessage({ ...base, type: 'price', condition: 'cross', value: 65000 } as Alert, 65010.5, 65000)).toBe(
      'BTCUSDT price crossed 65000.00 (65010.50)',
    )
    expect(
      alertMessage({ ...base, type: 'indicator', condition: 'above', value: 70, indicator: { id: 'rsi', length: 14, tf: '1h' }, note: 'take profit' } as Alert, 71.234, 70),
    ).toBe('BTCUSDT RSI(14) 1h rose above 70.0000 (71.2340) — take profit')
  })
  it('quotes AppleScript strings safely', () => {
    expect(appleScriptString('BTC "moon"\nnow \\ ok')).toBe('"BTC \\"moon\\" now \\\\ ok"')
  })
  it('accepts valid inputs and rejects bad ones', () => {
    const ok = parseAlertInput({ type: 'price', category: 'spot', symbol: 'ethusdt', condition: 'below', value: 1800, note: ' hi ' }, T0)
    expect(ok).toEqual({ type: 'price', category: 'spot', symbol: 'ETHUSDT', condition: 'below', trigger: 'once', value: 1800, note: 'hi' })
    const bad = (body: unknown) => expect(() => parseAlertInput(body, T0)).toThrow()
    bad({ type: 'price', category: 'inverse', symbol: 'BTCUSD', condition: 'cross', value: 1 })
    bad({ type: 'price', category: 'linear', symbol: 'BTCUSDT', condition: 'touch', value: 1 })
    bad({ type: 'price', category: 'linear', symbol: 'BTCUSDT', condition: 'cross', value: -1 })
    bad({ type: 'price', category: 'linear', symbol: 'BTCUSDT', condition: 'cross', value: 1, expiresAt: T0 - 1 })
    bad({ type: 'indicator', category: 'linear', symbol: 'BTCUSDT', condition: 'cross', value: 1, indicator: { id: 'macd', length: 14, tf: '1h' } })
    bad({ type: 'indicator', category: 'linear', symbol: 'BTCUSDT', condition: 'cross', value: 1, indicator: { id: 'rsi', length: 0, tf: '1h' } })
    bad({ type: 'line', category: 'linear', symbol: 'BTCUSDT', condition: 'cross', line: { drawingId: 'x', kind: 'segment', points: [{ timestamp: 1, value: 1 }] } })
    bad({ type: 'volume' })
  })
})

describe('alert routes', () => {
  const setupApp = () => {
    const f = fakeFeed()
    const fired: FiredAlert[] = []
    const app = buildApp({
      config: DEFAULT_CONFIG, db: openDb(':memory:'), rest: {} as BybitRest, feed: f.feed,
      channels: [{ id: 'test', send: async (x) => void fired.push(x) }],
    })
    return { app, fired, ...f }
  }
  it('creates, lists, pauses, fires into history and deletes', async () => {
    const { app, fired, active } = setupApp()
    const created = await app.fastify.inject({
      method: 'POST', url: '/api/alerts',
      payload: { type: 'price', category: 'linear', symbol: 'BTCUSDT', condition: 'cross', value: 100 },
    })
    expect(created.statusCode).toBe(200)
    const id = created.json().alert.id as string
    expect(active.has('price:linear:BTCUSDT')).toBe(true)
    expect((await app.fastify.inject('/api/alerts')).json().alerts).toHaveLength(1)

    expect((await app.fastify.inject({ method: 'PATCH', url: `/api/alerts/${id}`, payload: { status: 'paused' } })).json().alert.status).toBe('paused')
    expect((await app.fastify.inject({ method: 'PATCH', url: `/api/alerts/${id}`, payload: { status: 'done' } })).statusCode).toBe(400)
    expect((await app.fastify.inject({ method: 'PATCH', url: '/api/alerts/nope', payload: { status: 'paused' } })).statusCode).toBe(404)
    await app.fastify.inject({ method: 'PATCH', url: `/api/alerts/${id}`, payload: { status: 'active' } })

    app.alerts.onPrice('linear', 'BTCUSDT', 99, T0)
    app.alerts.onPrice('linear', 'BTCUSDT', 101, T0 + 1)
    expect(fired).toHaveLength(1)
    expect((await app.fastify.inject('/api/alerts/history')).json().history).toHaveLength(1)
    expect((await app.fastify.inject({ method: 'DELETE', url: '/api/alerts/history' })).statusCode).toBe(200)
    expect((await app.fastify.inject('/api/alerts/history')).json().history).toHaveLength(0)

    expect((await app.fastify.inject({ method: 'DELETE', url: `/api/alerts/${id}` })).statusCode).toBe(200)
    expect((await app.fastify.inject({ method: 'DELETE', url: `/api/alerts/${id}` })).statusCode).toBe(404)
  })
  it('sends a test notification through the OS channel only', async () => {
    const sent: FiredAlert[] = []
    const app = buildApp({
      config: DEFAULT_CONFIG, db: openDb(':memory:'), rest: {} as BybitRest, feed: fakeFeed().feed,
      channels: [{ id: 'os', send: async (x) => void sent.push(x) }],
    })
    expect((await app.fastify.inject({ method: 'POST', url: '/api/alerts/test-notification' })).json()).toEqual({ ok: true })
    expect(sent).toHaveLength(1)
    expect((await app.fastify.inject('/api/alerts/history')).json().history).toHaveLength(0)
    const none = setupApp() // its only extra channel is "test"
    expect((await none.app.fastify.inject({ method: 'POST', url: '/api/alerts/test-notification' })).statusCode).toBe(404)
  })
  it('rejects invalid alerts with 400', async () => {
    const { app } = setupApp()
    const res = await app.fastify.inject({ method: 'POST', url: '/api/alerts', payload: { type: 'price', category: 'linear', symbol: 'BTCUSDT' } })
    expect(res.statusCode).toBe(400)
  })
})
