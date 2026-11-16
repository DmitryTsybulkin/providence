import { dispose, init, LoadDataType, type Chart, type KLineData } from 'klinecharts'
import type { Candle } from '@providence/core'
import { ensureLocales, localeName } from './locale'
import { chartStyles, COLORS } from './theme'
import type { ChartEngine, ChartEngineOptions, ChartLocale, PageResult, SetDataOptions } from './types'

export function toKLine(c: Candle): KLineData {
  return { timestamp: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }
}

export function fromKLine(k: KLineData): Candle {
  return { t: k.timestamp, o: k.open, h: k.high, l: k.low, c: k.close, v: k.volume ?? 0 }
}

/** ChartEngine backed by KLineChart 9.x. */
export class KLineEngine implements ChartEngine {
  protected readonly chart: Chart
  /** Bumped on every setData so that late page results for an old series are dropped. */
  private generation = 0
  private newerMore = false
  private loadOlder: ((oldest: Candle) => Promise<PageResult>) | null = null
  private loadNewer: ((newest: Candle) => Promise<PageResult>) | null = null

  constructor(
    protected readonly container: HTMLElement,
    options: ChartEngineOptions,
  ) {
    ensureLocales()
    const chart = init(container, { locale: localeName(options.locale), styles: chartStyles })
    if (!chart) throw new Error('Failed to initialise the chart')
    this.chart = chart

    chart.setLoadDataCallback(({ type, data, callback }) => {
      const generation = this.generation
      // KLineChart naming: "forward" = older candles (left edge), "backward" = newer (right edge).
      const older = type === LoadDataType.Forward
      const handler = older ? this.loadOlder : this.loadNewer
      if (!data || !handler || (!older && !this.newerMore)) {
        // Nothing to load now. `more = true` keeps the direction armed for a later scroll.
        callback([], true)
        return
      }
      handler(fromKLine(data))
        .then((page) => {
          if (generation !== this.generation) return
          if (!older) this.newerMore = page.more
          callback(page.candles.map(toKLine), page.more)
        })
        .catch(() => {
          // Allow a retry on the next scroll.
          if (generation === this.generation) callback([], true)
        })
    })
  }

  setPrecision(price: number, volume: number): void {
    this.chart.setPriceVolumePrecision(price, volume)
  }

  setData(candles: Candle[], opts: SetDataOptions): Promise<void> {
    const generation = ++this.generation
    // Hold back right-edge paging until the view has been moved to its target (applyNewData is async
    // and first shows the newest candle, which would immediately trigger a "newer" page load).
    this.newerMore = false
    return new Promise((resolve) => {
      this.chart.applyNewData(candles.map(toKLine), opts.olderMore, () => {
        if (generation === this.generation) {
          if (opts.scrollTo !== undefined && candles.length) this.chart.scrollToTimestamp(opts.scrollTo)
          this.newerMore = opts.newerMore
        }
        resolve()
      })
    })
  }

  update(candle: Candle): void {
    this.chart.updateData(toKLine(candle))
  }

  getCandles(): Candle[] {
    return this.chart.getDataList().map(fromKLine)
  }

  candleCount(): number {
    return this.chart.getDataList().length
  }

  lastCandle(): Candle | null {
    const list = this.chart.getDataList()
    return list.length ? fromKLine(list[list.length - 1]) : null
  }

  onLoadOlder(cb: (oldest: Candle) => Promise<PageResult>): void {
    this.loadOlder = cb
  }

  onLoadNewer(cb: (newest: Candle) => Promise<PageResult>): void {
    this.loadNewer = cb
  }

  scrollToTime(time: number): void {
    this.chart.scrollToTimestamp(time)
  }

  scrollToRealTime(): void {
    this.chart.scrollToRealTime()
  }

  getRightEdgeTime(): number | null {
    const list = this.chart.getDataList()
    const range = this.chart.getVisibleRange()
    if (list.length === 0 || range.to >= list.length) return null
    // `range.to` is exclusive and counts the partly visible bar; `to - 2` is the bar that
    // scrollToTimestamp() puts at the right edge, so get → scroll round-trips without drift.
    return list[Math.max(0, range.to - 2)].timestamp
  }

  visibleBarCount(): number {
    const range = this.chart.getVisibleRange()
    return Math.max(0, range.to - range.from)
  }

  setLocale(locale: ChartLocale): void {
    this.chart.setLocale(localeName(locale))
  }

  resize(): void {
    this.chart.resize()
  }

  screenshot(): string {
    return this.chart.getConvertPictureUrl(true, 'png', COLORS.bg)
  }

  dispose(): void {
    this.generation++
    dispose(this.container)
  }
}
