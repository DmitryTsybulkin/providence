import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Candle, CandleQuery, DataAdapter } from '@providence/core'
import type { ChartEngine, PageResult, SetDataOptions } from '../chart'
import { CellController, MAX_CANDLES, type CellStatus } from './cellController'

const H = 3_600_000
const T0 = Date.UTC(2026, 0, 1)
const NOW = T0 + 5000 * H + 60_000 // candle #5000 is forming
const mk = (i: number): Candle => ({ t: T0 + i * H, o: 1, h: 1, l: 1, c: 1, v: 1 })

/** Adapter over a synthetic series #0..#5000 */
function fakeAdapter() {
  const queries: CandleQuery[] = []
  let live: ((c: Candle) => void) | null = null
  const subs: string[] = []
  const adapter: DataAdapter = {
    id: 'fake',
    listSymbols: async () => [],
    getTickers: async () => [],
    async getCandles(q) {
      queries.push(q)
      const lastIndex = Math.min(5000, q.to === undefined ? 5000 : Math.floor((q.to - T0) / H))
      const out: Candle[] = []
      for (let i = Math.max(0, lastIndex - q.limit + 1); i <= lastIndex; i++) out.push(mk(i))
      return out
    },
    subscribeCandles(symbol, tf, cb) {
      subs.push(`+${symbol}:${tf}`)
      live = cb
      return () => subs.push(`-${symbol}:${tf}`)
    },
  }
  return { adapter, queries, subs, push: (c: Candle) => live?.(c) }
}

function fakeEngine() {
  let data: Candle[] = []
  const state = { opts: null as SetDataOptions | null, scrolledTo: null as number | null, visible: 100 }
  let older: ((c: Candle) => Promise<PageResult>) | null = null
  let newer: ((c: Candle) => Promise<PageResult>) | null = null
  const engine: ChartEngine = {
    setPrecision() {},
    async setData(candles, opts) {
      data = [...candles]
      state.opts = opts
    },
    update(c) {
      const last = data[data.length - 1]
      if (!last || c.t > last.t) data.push(c)
      else if (c.t === last.t) data[data.length - 1] = c
    },
    getCandles: () => data,
    candleCount: () => data.length,
    lastCandle: () => data[data.length - 1] ?? null,
    onLoadOlder: (cb) => (older = cb),
    onLoadNewer: (cb) => (newer = cb),
    scrollToTime: (t) => (state.scrolledTo = t),
    scrollToRealTime() {},
    getRightEdgeTime: () => null,
    visibleBarCount: () => state.visible,
    setLocale() {},
    resize() {},
    screenshot: () => '',
    dispose() {},
  }
  return {
    engine,
    state,
    index: (c: Candle) => (c.t - T0) / H,
    pageOlder: async () => {
      const page = await older!(data[0])
      data = [...page.candles, ...data]
      return page
    },
    pageNewer: async () => {
      const page = await newer!(data[data.length - 1])
      data = [...data, ...page.candles]
      return page
    },
    fill: (n: number) => (data = Array.from({ length: n }, (_, i) => mk(i))),
  }
}

describe('CellController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 16))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const setup = () => {
    const a = fakeAdapter()
    const e = fakeEngine()
    const statuses: CellStatus[] = []
    const ctrl = new CellController(e.engine, a.adapter, (s) => statuses.push(s), () => NOW)
    return { ...a, ...e, ctrl, statuses, last: () => statuses[statuses.length - 1] }
  }
  const series = { symbolKey: 'linear:BTCUSDT', tf: '1h' } as const

  it('loads the latest 1000 candles and goes live', async () => {
    const s = setup()
    await s.ctrl.show(series)
    expect(s.queries[0]).toEqual({ symbol: 'linear:BTCUSDT', tf: '1h', to: undefined, limit: 1000 })
    expect(s.engine.candleCount()).toBe(1000)
    expect(s.state.opts).toEqual({ olderMore: true, newerMore: false, scrollTo: undefined })
    expect(s.last()).toMatchObject({ loading: false, live: true, error: null })
    expect(s.subs).toEqual(['+linear:BTCUSDT:1h'])
  })

  it('pages back with end = oldest.t − 1 and limit 1000', async () => {
    const s = setup()
    await s.ctrl.show(series)
    const page = await s.pageOlder()
    expect(s.queries[1]).toEqual({ symbol: 'linear:BTCUSDT', tf: '1h', to: T0 + 4001 * H - 1, limit: 1000 })
    expect(page.more).toBe(true)
    expect(s.engine.candleCount()).toBe(2000)
    expect(s.index(s.engine.getCandles()[0])).toBe(3001)
  })

  it('stops paging at the start of history and at the 50 000 cap', async () => {
    const s = setup()
    await s.ctrl.show(series, T0 + 500 * H) // window #0..#900
    expect(s.index(s.engine.getCandles()[0])).toBe(0)
    expect((await s.pageOlder()).more).toBe(false)

    const big = setup()
    await big.ctrl.show(series)
    big.fill(MAX_CANDLES)
    const page = await big.pageOlder()
    expect(page).toEqual({ candles: [], more: false })
  })

  it('opens a history window around a target and pages forward until it is live again', async () => {
    const s = setup()
    await s.ctrl.show(series, T0 + 2000 * H)
    expect(s.queries[0].to).toBe(T0 + 2400 * H)
    expect(s.state.opts).toEqual({ olderMore: true, newerMore: true, scrollTo: T0 + 2000 * H })
    expect(s.last().live).toBe(false)
    // live candles are ignored while looking at history
    s.push(mk(5000))
    vi.advanceTimersByTime(600)
    expect(s.index(s.engine.lastCandle()!)).toBe(2400)

    expect((await s.pageNewer()).more).toBe(true) // → #3400
    expect((await s.pageNewer()).more).toBe(true) // → #4400
    const final = await s.pageNewer() // reaches #5000
    expect(final.more).toBe(false)
    expect(s.index(s.engine.lastCandle()!)).toBe(5000)
    expect(s.last().live).toBe(true)
    const cs = s.engine.getCandles()
    expect(cs.every((c, i) => i === 0 || c.t - cs[i - 1].t === H)).toBe(true)
  })

  it('treats a target near the present as live', async () => {
    const s = setup()
    await s.ctrl.show(series, T0 + 4999 * H)
    expect(s.last().live).toBe(true)
    expect(s.queries[0].to).toBeUndefined()
  })

  it('applies live candles on the next frame, coalesced', async () => {
    const s = setup()
    await s.ctrl.show(series)
    s.push({ ...mk(5000), c: 2 })
    s.push({ ...mk(5000), c: 3 })
    s.push(mk(5001))
    expect(s.engine.lastCandle()!.c).toBe(1)
    vi.advanceTimersByTime(20)
    expect(s.engine.candleCount()).toBe(1001)
    expect(s.engine.getCandles()[999].c).toBe(3)
  })

  it('reloads instead of drawing a hole when the live feed skipped candles', async () => {
    const s = setup()
    await s.ctrl.show(series)
    s.push(mk(5003))
    await vi.advanceTimersByTimeAsync(20)
    expect(s.queries).toHaveLength(2)
    expect(s.index(s.engine.lastCandle()!)).toBe(5000) // reloaded from REST, no hole
  })

  it('resubscribes when the series changes and ignores a superseded load', async () => {
    const s = setup()
    const first = s.ctrl.show(series)
    const second = s.ctrl.show({ symbolKey: 'spot:ETHUSDT', tf: '4h' })
    await Promise.all([first, second])
    expect(s.subs).toEqual(['+linear:BTCUSDT:1h', '-linear:BTCUSDT:1h', '+spot:ETHUSDT:4h'])
    expect(s.statuses.filter((x) => !x.loading)).toHaveLength(1)
  })

  it('go to date scrolls inside loaded data, otherwise loads a window', async () => {
    const s = setup()
    await s.ctrl.show(series)
    await s.ctrl.goTo(T0 + 4500 * H) // loaded: #4001..#5000, centre + 50 bars
    expect(s.state.scrolledTo).toBe(T0 + 4550 * H)
    expect(s.queries).toHaveLength(1)
    await s.ctrl.goTo(T0 + 1000 * H)
    expect(s.queries).toHaveLength(2)
    expect(s.state.opts?.scrollTo).toBe(T0 + 1050 * H)
  })

  it('reports load errors', async () => {
    const s = setup()
    s.adapter.getCandles = async () => {
      throw new Error('boom')
    }
    await s.ctrl.show(series)
    expect(s.last()).toMatchObject({ loading: false, error: 'boom' })
  })
})
