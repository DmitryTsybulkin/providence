import { dispose, init, LoadDataType, type Chart, type Indicator, type KLineData } from 'klinecharts'
import type { Candle, IndicatorState } from '@providence/core'
import { ensureIndicatorsRegistered, getIndicatorDef, toKLineSpec } from './indicators'
import { ensureLocales, localeName } from './locale'
import { chartStyles, COLORS } from './theme'
import type { ChartEngine, ChartEngineOptions, ChartLocale, IndicatorSeries, PageResult, SetDataOptions } from './types'

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
  private pricePrecision = 2
  private indicators: IndicatorState[] = []
  private indicatorSignature = ''
  private appliedIndicators: { id: string; paneId: string; name: string; calcParams: number[] }[] = []

  constructor(
    protected readonly container: HTMLElement,
    options: ChartEngineOptions,
  ) {
    ensureLocales()
    ensureIndicatorsRegistered()
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
    if (price !== this.pricePrecision) {
      this.pricePrecision = price
      this.setIndicators(this.indicators) // some indicators derive their precision from the price
    }
  }

  setIndicators(list: IndicatorState[]): void {
    this.indicators = list
    const signature = `${this.pricePrecision}|${JSON.stringify(list)}`
    if (signature === this.indicatorSignature) return
    this.indicatorSignature = signature

    for (const a of this.appliedIndicators) this.chart.removeIndicator(a.paneId, a.name)
    this.appliedIndicators = []
    for (const state of list) {
      const def = getIndicatorDef(state.id)
      if (!def || !state.visible) continue
      const spec = toKLineSpec(def, state.params, this.pricePrecision)
      const overlay = def.pane === 'overlay'
      const paneId = this.chart.createIndicator(
        spec,
        overlay, // stack on the candle pane
        overlay ? { id: 'candle_pane' } : { id: `pane_${def.id}`, height: 110, minHeight: 48 },
      )
      if (paneId) this.appliedIndicators.push({ id: def.id, paneId, name: spec.name, calcParams: spec.calcParams })
    }
  }

  getIndicatorData(): IndicatorSeries[] {
    const candles = this.chart.getDataList()
    return this.appliedIndicators.flatMap((a) => {
      const indicator = this.chart.getIndicatorByPaneId(a.paneId, a.name) as Indicator | null
      if (!indicator || !Array.isArray(indicator.result)) return []
      const keys = indicator.figures.map((f) => f.key)
      const data = candles.map((c, i) => {
        const row = (indicator.result[i] ?? {}) as Record<string, number | undefined>
        return [c.timestamp, ...keys.map((k) => (typeof row[k] === 'number' && Number.isFinite(row[k]) ? (row[k] as number) : null))]
      })
      return [{ id: a.id, name: indicator.shortName || a.name, params: a.calcParams, keys, data }]
    })
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
