/**
 * Connects one chart cell to market data: initial load, history paging in both directions,
 * live updates, hole detection and "go to date". Knows nothing about the chart library.
 */
import { candleOpenTime, tfMs, type Candle, type DataAdapter, type Timeframe, type Unsubscribe } from '@providence/core'
import type { ChartEngine, PageResult } from '../chart'

export const PAGE_SIZE = 1000
/** chart.md §4: at most 50 000 candles in memory per chart. */
export const MAX_CANDLES = 50_000
/** Candles to load after the target when jumping to a date. */
const LOOKAHEAD = 400

export interface CellStatus {
  loading: boolean
  error: string | null
  /** True when the loaded window reaches the present and receives live updates. */
  live: boolean
  empty: boolean
}

export interface Series {
  symbolKey: string
  tf: Timeframe
}

export class CellController {
  private series: Series | null = null
  private seq = 0
  private live = false
  private unsubscribe: Unsubscribe | null = null
  private pending: Candle[] = []
  private frame: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private reloading = false
  private status: CellStatus = { loading: false, error: null, live: false, empty: false }

  constructor(
    private readonly engine: ChartEngine,
    private readonly adapter: DataAdapter,
    private readonly onStatus: (s: CellStatus) => void,
    private readonly now: () => number = Date.now,
  ) {
    engine.onLoadOlder((oldest) => this.loadOlder(oldest))
    engine.onLoadNewer((newest) => this.loadNewer(newest))
  }

  /**
   * Show a series. `target` = time to put at the right edge (keeps the view when switching
   * timeframe, or jumps to a date); omit for the latest candles.
   */
  async show(series: Series, target?: number | null): Promise<void> {
    const seq = ++this.seq
    const changed = this.series?.symbolKey !== series.symbolKey || this.series?.tf !== series.tf
    this.series = series
    if (changed) this.resubscribe()
    this.pending = []
    this.setStatus({ loading: true, error: null })

    const { tf, symbolKey } = series
    const size = tfMs(tf)
    const now = this.now()
    const formingOpen = candleOpenTime(now, tf)
    const wantHistory = target != null && target < formingOpen - 2 * size
    const to = wantHistory ? (target as number) + LOOKAHEAD * size : undefined
    const reachesNow = to === undefined || to >= formingOpen

    try {
      const candles = await this.adapter.getCandles({ symbol: symbolKey, tf, to: reachesNow ? undefined : to, limit: PAGE_SIZE })
      if (seq !== this.seq) return
      this.live = reachesNow
      await this.engine.setData(candles, {
        olderMore: candles.length >= PAGE_SIZE,
        newerMore: !reachesNow,
        scrollTo: wantHistory && candles.length ? Math.max(target as number, candles[0].t) : undefined,
      })
      if (seq !== this.seq) return
      this.setStatus({ loading: false, live: this.live, empty: candles.length === 0 })
    } catch (err) {
      if (seq !== this.seq) return
      this.setStatus({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Jump so that `time` is roughly in the middle of the view. */
  goTo(time: number): Promise<void> {
    if (!this.series) return Promise.resolve()
    const size = tfMs(this.series.tf)
    const target = candleOpenTime(time, this.series.tf) + Math.floor(this.engine.visibleBarCount() / 2) * size
    const candles = this.engine.candleCount()
    const first = candles ? this.engine.getCandles()[0].t : Infinity
    const last = this.engine.lastCandle()?.t ?? -Infinity
    if (time >= first && target <= last) {
      this.engine.scrollToTime(target)
      return Promise.resolve()
    }
    return this.show(this.series, target)
  }

  goLive(): Promise<void> {
    if (!this.series) return Promise.resolve()
    if (this.live) {
      this.engine.scrollToRealTime()
      return Promise.resolve()
    }
    return this.show(this.series)
  }

  reload(): Promise<void> {
    return this.series ? this.show(this.series) : Promise.resolve()
  }

  dispose(): void {
    this.seq++
    this.unsubscribe?.()
    this.unsubscribe = null
    this.cancelFlush()
  }

  // ---------- paging ----------

  private async loadOlder(oldest: Candle): Promise<PageResult> {
    const s = this.series
    if (!s) return { candles: [], more: false }
    if (this.engine.candleCount() >= MAX_CANDLES) return { candles: [], more: false }
    // market-data §4: request end = oldestLoaded.t − 1, limit = 1000
    const candles = await this.adapter.getCandles({ symbol: s.symbolKey, tf: s.tf, to: oldest.t - 1, limit: PAGE_SIZE })
    const older = candles.filter((c) => c.t < oldest.t)
    const total = this.engine.candleCount() + older.length
    return { candles: older, more: older.length >= PAGE_SIZE && total < MAX_CANDLES }
  }

  private async loadNewer(newest: Candle): Promise<PageResult> {
    const s = this.series
    if (!s) return { candles: [], more: false }
    const size = tfMs(s.tf)
    const formingOpen = candleOpenTime(this.now(), s.tf)
    const to = newest.t + PAGE_SIZE * size
    const reachesNow = to >= formingOpen
    const candles = await this.adapter.getCandles({ symbol: s.symbolKey, tf: s.tf, to: reachesNow ? undefined : to, limit: PAGE_SIZE })
    const newer = candles.filter((c) => c.t > newest.t)
    // If the page did not connect to what is loaded (a hole), fall back to a clean live reload.
    if (reachesNow && newer.length && newer[0].t > newest.t + size) {
      void this.show(s)
      return { candles: [], more: false }
    }
    if (reachesNow) {
      this.live = true
      this.setStatus({ live: true })
    }
    return { candles: newer, more: !reachesNow }
  }

  // ---------- live ----------

  private resubscribe(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    const s = this.series
    if (!s) return
    this.unsubscribe = this.adapter.subscribeCandles(s.symbolKey, s.tf, (c) => this.onLiveCandle(c))
  }

  private onLiveCandle(c: Candle): void {
    if (!this.live || this.status.loading) return
    this.pending.push(c)
    // Throttle redraws to one per animation frame (chart.md §6). Background tabs get no animation
    // frames, so a timer makes sure the queue is still drained there.
    if (this.frame === null) this.frame = requestAnimationFrame(() => this.flush())
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), 500)
  }

  private cancelFlush(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    if (this.timer !== null) clearTimeout(this.timer)
    this.frame = null
    this.timer = null
  }

  private flush(): void {
    this.cancelFlush()
    const s = this.series
    const batch = this.pending
    this.pending = []
    if (!s || !this.live) return
    const size = tfMs(s.tf)
    for (const c of batch) {
      const last = this.engine.lastCandle()
      if (last && c.t > last.t + size) {
        // A candle is missing between the chart and the live feed → reload instead of drawing a hole.
        if (!this.reloading) {
          this.reloading = true
          void this.show(s).finally(() => (this.reloading = false))
        }
        return
      }
      this.engine.update(c)
    }
    if (this.status.empty && batch.length) this.setStatus({ empty: false })
  }

  private setStatus(patch: Partial<CellStatus>): void {
    this.status = { ...this.status, ...patch }
    this.onStatus(this.status)
  }
}
