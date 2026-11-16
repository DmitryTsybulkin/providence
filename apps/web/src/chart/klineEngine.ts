import {
  ActionType, dispose, init, LoadDataType, OverlayMode,
  type Chart, type Indicator, type KLineData, type Overlay, type OverlayCreate, type Point,
} from 'klinecharts'
import type { Candle, DrawingShape, IndicatorState } from '@providence/core'
import { indexToTime, inferInterval, inRange, timeToIndex } from './anchor'
import { ensureIndicatorsRegistered, getIndicatorDef, toKLineSpec } from './indicators'
import { ensureLocales, localeName } from './locale'
import { ensureOverlaysRegistered, overlayInterval } from './overlays'
import { chartStyles, COLORS } from './theme'
import type {
  ChartEngine, ChartEngineOptions, ChartLocale, DrawingEvent, DrawingOptions, DrawingPatch, IndicatorSeries, PageResult,
  SetDataOptions,
} from './types'

const DRAWING_GROUP = 'drawings'

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
  /** Canonical drawings in data coordinates (timestamp, value), keyed by id. */
  private shapes = new Map<string, DrawingShape>()
  private progressId: string | null = null
  private movingId: string | null = null
  private selectedId: string | null = null
  private drawingOptions: DrawingOptions = { magnet: false, lockAll: false, hideAll: false }
  private readonly drawingListeners = new Set<(e: DrawingEvent) => void>()
  private rangeSignature = ''

  constructor(
    protected readonly container: HTMLElement,
    options: ChartEngineOptions,
  ) {
    ensureLocales()
    ensureIndicatorsRegistered()
    ensureOverlaysRegistered()
    const chart = init(container, { locale: localeName(options.locale), styles: chartStyles })
    if (!chart) throw new Error('Failed to initialise the chart')
    this.chart = chart
    chart.subscribeAction(ActionType.OnDataReady, () => this.onDataRange())

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
    for (const id of this.shapes.keys()) overlayInterval.delete(id)
    if (this.progressId) overlayInterval.delete(this.progressId)
    this.drawingListeners.clear()
    dispose(this.container)
  }

  // ---------- drawings ----------

  startDrawing(toolId: string, extendData?: unknown): boolean {
    this.cancelDrawing()
    const id = this.chart.createOverlay({
      name: toolId,
      groupId: DRAWING_GROUP,
      mode: this.overlayMode(),
      ...(extendData !== undefined ? { extendData } : {}),
      ...this.overlayHandlers(),
    })
    if (typeof id !== 'string') return false
    this.progressId = id
    overlayInterval.set(id, () => this.interval())
    return true
  }

  cancelDrawing(): void {
    if (!this.progressId) return
    const id = this.progressId
    this.progressId = null
    overlayInterval.delete(id)
    this.chart.removeOverlay(id)
    this.emit({ type: 'tool-end' })
  }

  setDrawings(shapes: DrawingShape[]): void {
    this.cancelDrawing()
    for (const id of this.shapes.keys()) {
      this.chart.removeOverlay(id)
      overlayInterval.delete(id)
    }
    this.shapes = new Map()
    const times = this.times()
    const interval = inferInterval(times)
    for (const shape of shapes) {
      this.shapes.set(shape.id, shape)
      overlayInterval.set(shape.id, () => this.interval())
      this.chart.createOverlay({
        name: shape.name,
        id: shape.id,
        groupId: DRAWING_GROUP,
        points: this.anchor(shape, times, interval),
        ...(shape.styles ? { styles: shape.styles } : {}),
        ...(shape.extendData !== undefined ? { extendData: shape.extendData } : {}),
        lock: this.effectiveLock(shape),
        visible: this.effectiveVisible(shape),
        mode: this.overlayMode(),
        ...this.overlayHandlers(),
      })
    }
    if (this.selectedId) {
      this.selectedId = null
      this.emit({ type: 'select', shape: null })
    }
  }

  getDrawings(): DrawingShape[] {
    return [...this.shapes.values()]
  }

  updateDrawing(id: string, patch: DrawingPatch): void {
    const shape = this.shapes.get(id)
    if (!shape) return
    const next = { ...shape, ...patch }
    this.shapes.set(id, next)
    this.chart.overrideOverlay({
      id,
      ...(patch.styles ? { styles: patch.styles } : {}),
      ...('extendData' in patch ? { extendData: patch.extendData } : {}),
      lock: this.effectiveLock(next),
      visible: this.effectiveVisible(next),
    })
    this.emit({ type: 'change', shapes: this.getDrawings() })
    if (this.selectedId === id) this.emit({ type: 'select', shape: next })
  }

  removeDrawing(id: string): void {
    if (!this.shapes.delete(id)) return
    overlayInterval.delete(id)
    this.chart.removeOverlay(id)
    this.emit({ type: 'change', shapes: this.getDrawings() })
    if (this.selectedId === id) {
      this.selectedId = null
      this.emit({ type: 'select', shape: null })
    }
  }

  setDrawingOptions(options: Partial<DrawingOptions>): void {
    this.drawingOptions = { ...this.drawingOptions, ...options }
    for (const shape of this.shapes.values()) {
      this.chart.overrideOverlay({
        id: shape.id,
        lock: this.effectiveLock(shape),
        visible: this.effectiveVisible(shape),
        mode: this.overlayMode(),
      })
    }
  }

  onDrawingEvent(cb: (e: DrawingEvent) => void): () => void {
    this.drawingListeners.add(cb)
    return () => this.drawingListeners.delete(cb)
  }

  private emit(e: DrawingEvent): void {
    this.drawingListeners.forEach((cb) => cb(e))
  }

  private overlayMode(): OverlayMode {
    return this.drawingOptions.magnet ? OverlayMode.WeakMagnet : OverlayMode.Normal
  }

  private effectiveLock(shape: DrawingShape): boolean {
    return this.drawingOptions.lockAll || shape.lock === true
  }

  private effectiveVisible(shape: DrawingShape): boolean {
    return !this.drawingOptions.hideAll && shape.visible !== false
  }

  private times(): number[] {
    return this.chart.getDataList().map((d) => d.timestamp)
  }

  private interval(): number {
    const list = this.chart.getDataList()
    const n = list.length
    return n >= 2 ? list[n - 1].timestamp - list[n - 2].timestamp : 60_000
  }

  /**
   * Canonical points → what KLineChart needs. Inside the loaded range a point is given by timestamp (the library
   * snaps it to the nearest candle, which also makes it survive a timeframe switch). Outside the range the
   * library has no timestamps, so the bar index is extrapolated.
   */
  private anchor(shape: DrawingShape, times: number[], interval: number): Array<Partial<Point>> {
    return shape.points.map((p) =>
      inRange(times, p.timestamp)
        ? { timestamp: p.timestamp, value: p.value }
        : { dataIndex: timeToIndex(times, p.timestamp, interval), value: p.value },
    )
  }

  /** Read an overlay back into a canonical shape after the user drew or moved it. */
  private capture(overlay: Overlay): DrawingShape {
    const times = this.times()
    const interval = inferInterval(times)
    const prev = this.shapes.get(overlay.id)
    const shape: DrawingShape = {
      id: overlay.id,
      name: overlay.name,
      points: overlay.points.map((p) => ({
        timestamp: typeof p.timestamp === 'number' ? p.timestamp : indexToTime(times, p.dataIndex ?? 0, interval),
        value: p.value ?? 0,
      })),
      ...(overlay.styles ? { styles: overlay.styles as Record<string, unknown> } : {}),
      ...(overlay.extendData !== undefined && overlay.extendData !== null ? { extendData: overlay.extendData } : {}),
      ...(prev?.lock ? { lock: true } : {}),
      ...(prev?.visible === false ? { visible: false } : {}),
    }
    this.shapes.set(shape.id, shape)
    return shape
  }

  private overlayHandlers(): Partial<OverlayCreate> {
    return {
      onDrawEnd: ({ overlay }) => {
        if (this.progressId === overlay.id) this.progressId = null
        const shape = this.capture(overlay)
        this.selectedId = shape.id
        this.emit({ type: 'change', shapes: this.getDrawings() })
        this.emit({ type: 'tool-end' })
        this.emit({ type: 'select', shape })
        return false
      },
      onPressedMoveStart: ({ overlay }) => {
        this.movingId = overlay.id
        return false
      },
      onPressedMoveEnd: ({ overlay }) => {
        this.movingId = null
        if (!this.shapes.has(overlay.id)) return false
        const shape = this.capture(overlay)
        this.emit({ type: 'change', shapes: this.getDrawings() })
        if (this.selectedId === shape.id) this.emit({ type: 'select', shape })
        return false
      },
      onSelected: ({ overlay }) => {
        const shape = this.shapes.get(overlay.id)
        if (shape) {
          this.selectedId = shape.id
          this.emit({ type: 'select', shape })
        }
        return false
      },
      onDeselected: ({ overlay }) => {
        if (this.selectedId === overlay.id) {
          this.selectedId = null
          this.emit({ type: 'select', shape: null })
        }
        return false
      },
      // KLineChart deletes an overlay on right-click unless the handler returns true.
      onRightClick: () => true,
    }
  }

  /** The loaded candle range changed → points outside it need new extrapolated indices. */
  private onDataRange(): void {
    const list = this.chart.getDataList()
    const signature = list.length ? `${list[0].timestamp}:${list[list.length - 1].timestamp}:${list.length}` : ''
    if (signature === this.rangeSignature) return
    this.rangeSignature = signature
    const times = list.map((d) => d.timestamp)
    const interval = inferInterval(times)
    for (const shape of this.shapes.values()) {
      if (shape.id === this.movingId) continue
      this.chart.overrideOverlay({ id: shape.id, points: this.anchor(shape, times, interval) })
    }
  }
}
