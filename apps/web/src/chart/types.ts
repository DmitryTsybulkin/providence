/**
 * ChartEngine: the only way the app talks to the chart library (architecture §4).
 * Nothing in this file refers to klinecharts, so the library stays swappable.
 */
import type { Candle, DrawingShape, IndicatorState } from '@providence/core'

export interface PageResult {
  candles: Candle[]
  /** Whether more data exists further in that direction. */
  more: boolean
}

export interface SetDataOptions {
  /** Older candles can be paged in when the user scrolls to the left edge. */
  olderMore: boolean
  /** Newer candles exist (the loaded window does not reach the present). */
  newerMore: boolean
  /** Put the candle at this time at the right edge once the data is in; default = latest candle. */
  scrollTo?: number
}

/** Computed values of one indicator, for export. */
export interface IndicatorSeries {
  id: string
  name: string
  params: (number | string)[]
  /** Value column names, e.g. ["ma1", "ma2"] */
  keys: string[]
  /** One row per candle: [time, ...values]; `null` where the indicator has no value */
  data: (number | null)[][]
}

export type DrawingEvent =
  /** Drawings were created, moved, restyled or removed by the user. */
  | { type: 'change'; shapes: DrawingShape[] }
  | { type: 'select'; shape: DrawingShape | null }
  /** The active drawing tool finished or was cancelled. */
  | { type: 'tool-end' }

export interface DrawingOptions {
  /** Snap new points to candle OHLC values */
  magnet: boolean
  lockAll: boolean
  hideAll: boolean
}

export type DrawingPatch = Partial<Pick<DrawingShape, 'styles' | 'extendData' | 'lock' | 'visible'>>

export type ChartLocale = 'en' | 'ru'

export interface ChartEngineOptions {
  locale: ChartLocale
}

export interface ChartEngine {
  setPrecision(price: number, volume: number): void
  /** Replace all candles (oldest first). Resolves once the chart has taken the data. */
  setData(candles: Candle[], opts: SetDataOptions): Promise<void>
  /** Replace the last candle or append a newer one. Older candles are ignored. */
  update(candle: Candle): void
  getCandles(): Candle[]
  candleCount(): number
  lastCandle(): Candle | null
  /** Called when the user reaches the left edge; `oldest` is the first loaded candle. */
  onLoadOlder(cb: (oldest: Candle) => Promise<PageResult>): void
  /** Called when the user reaches the right edge while newer data exists. */
  onLoadNewer(cb: (newest: Candle) => Promise<PageResult>): void

  /** Put the candle at `time` at the right edge of the view. */
  scrollToTime(time: number): void
  scrollToRealTime(): void
  /** Open time of the candle at the right edge, or `null` when the latest candle is in view. */
  getRightEdgeTime(): number | null
  visibleBarCount(): number

  /** Apply the cell's indicator list (hidden ones are not drawn). Idempotent. */
  setIndicators(list: IndicatorState[]): void
  /** Values of every visible indicator for the loaded candles. */
  getIndicatorData(): IndicatorSeries[]

  /** Start placing a drawing with the given tool; the next clicks on the chart set its points. */
  startDrawing(toolId: string, extendData?: unknown): boolean
  cancelDrawing(): void
  /** Replace all drawings (e.g. after loading a symbol or an undo). Does not emit a change event. */
  setDrawings(shapes: DrawingShape[]): void
  getDrawings(): DrawingShape[]
  updateDrawing(id: string, patch: DrawingPatch): void
  removeDrawing(id: string): void
  setDrawingOptions(options: Partial<DrawingOptions>): void
  onDrawingEvent(cb: (e: DrawingEvent) => void): () => void

  setLocale(locale: ChartLocale): void
  resize(): void
  /** PNG data URL of the whole chart including indicators and drawings. */
  screenshot(): string
  dispose(): void
}
