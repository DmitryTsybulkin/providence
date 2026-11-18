/**
 * Drawing tools: KLineChart built-in overlays plus custom ones registered with `registerOverlay`.
 *
 * Built-ins of klinecharts 9.8.12 (getSupportedOverlays()): fibonacciLine, horizontalRayLine, horizontalSegment,
 * horizontalStraightLine, parallelStraightLine, priceChannelLine, priceLine, rayLine, segment, straightLine,
 * verticalRayLine, verticalSegment, verticalStraightLine, simpleAnnotation, simpleTag.
 * Not built in → custom: longPosition, shortPosition, priceRange, dateRange, text, arrow.
 */
import { registerOverlay, type OverlayTemplate } from 'klinecharts'
import {
  formatDuration, positionOutcome, positionStats, priceRangeStats,
  type DrawingShape, type DrawingTool, type LineKind, type OhlcBar, type PositionSide,
} from '@providence/core'
import { COLORS } from './theme'

// ---------- tool catalogue ----------

const builtin = (id: string, label: string, group: DrawingTool['group']): DrawingTool => ({ id, label, group })

const PROFIT = 'rgba(46,189,133,0.18)'
const LOSS = 'rgba(246,70,93,0.18)'
const LABEL_TEXT = '#ffffff'
const FONT = '-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif'

/** Per-overlay access to its chart: bar interval (dateRange) and loaded candles (position outcome). Set by the engine. */
export interface OverlayContext {
  interval(): number
  bars(): readonly OhlcBar[]
}
export const overlayContext = new Map<string, OverlayContext>()

/** Distance of the default stop from the entry, in pixels at the moment the position is placed. */
export const POSITION_STOP_PX = 40
/** extendData marker of the current position format: points = [entry, target (+ end time), stop]. */
export const POSITION_FORMAT = 2

export function positionSide(name: string): PositionSide | null {
  return name === 'longPosition' ? 'long' : name === 'shortPosition' ? 'short' : null
}

interface Pt {
  x: number
  y: number
}

function label(text: string, x: number, y: number, background: string, align: CanvasTextAlign = 'center', baseline: CanvasTextBaseline = 'middle') {
  return {
    type: 'text',
    attrs: { x, y, text, align, baseline },
    styles: {
      style: 'fill',
      color: LABEL_TEXT,
      size: 11,
      family: FONT,
      weight: 'normal',
      paddingLeft: 5,
      paddingRight: 5,
      paddingTop: 3,
      paddingBottom: 3,
      borderRadius: 2,
      backgroundColor: background,
    },
    ignoreEvent: true,
  }
}

function rect(a: Pt, b: Pt, color: string) {
  return {
    type: 'rect',
    attrs: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) },
    styles: { style: 'fill', color },
  }
}

const signed = (v: number, digits: number) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`
const lineColor = (styles: unknown, fallback: string): string =>
  (styles as { line?: { color?: string } } | null)?.line?.color ?? fallback
const lineStyles = (styles: unknown, fallback: string) => {
  const line = (styles as { line?: { color?: string; size?: number; style?: string } } | null)?.line
  return { style: line?.style ?? 'solid', size: line?.size ?? 1, color: line?.color ?? fallback, dashedValue: [4, 4] }
}

/**
 * Long/short position. Placed with two clicks: the entry, then the target price and the end of the forecast.
 * The stop is a third point the engine adds when drawing ends, a fixed distance from the entry (it does not follow
 * the target); afterwards every level can be dragged on its own. Points = [entry, target, stop].
 */
function positionTemplate(name: 'longPosition' | 'shortPosition'): OverlayTemplate {
  const side: PositionSide = name === 'longPosition' ? 'long' : 'short'
  const dir = side === 'long' ? 1 : -1
  return {
    name,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ overlay, coordinates, precision, barSpace, xAxis, yAxis }) => {
      const pts = overlay.points
      if (coordinates.length < 2 || pts[0]?.value === undefined || pts[1]?.value === undefined) return []
      const [e, tk] = coordinates
      const entry = pts[0].value
      const take = pts[1].value
      const placedStop = coordinates.length > 2 && pts[2]?.value !== undefined
      // Long: stop below the entry (larger y). Short: above.
      const stopY = placedStop ? coordinates[2].y : e.y + dir * POSITION_STOP_PX
      const stop = placedStop ? (pts[2].value as number) : (yAxis?.convertFromPixel(stopY) ?? entry)
      const x1 = Math.min(e.x, tk.x)
      // At least one bar wide, so a 1-bar forecast is still visible.
      const x2 = Math.max(e.x, tk.x, x1 + barSpace.bar)
      const stats = positionStats(entry, stop, take, side)
      const p = precision.price
      const mid = (x1 + x2) / 2
      const edge = (y: number): CanvasTextBaseline => (y < e.y ? 'bottom' : 'top')
      const figures: unknown[] = [
        rect({ x: x1, y: e.y }, { x: x2, y: tk.y }, PROFIT),
        rect({ x: x1, y: e.y }, { x: x2, y: stopY }, LOSS),
        { type: 'line', attrs: { coordinates: [{ x: x1, y: e.y }, { x: x2, y: e.y }] }, styles: { style: 'solid', size: 1, color: COLORS.text } },
      ]

      // Dashed line from the entry to where the price first reached the target or the stop (or to the last bar
      // inside the forecast window). Only drawn when there are candles after the entry.
      const bars = overlayContext.get(overlay.id)?.bars() ?? []
      if (xAxis && yAxis && bars.length) {
        const i0 = Math.round(xAxis.convertFromPixel(e.x))
        const i1 = Math.round(xAxis.convertFromPixel(x2))
        const outcome = positionOutcome(bars, i0, i1, side, stop, take)
        if (outcome) {
          const color = outcome.kind === 'target' ? COLORS.up : outcome.kind === 'stop' ? COLORS.down : COLORS.text
          figures.push({
            type: 'line',
            attrs: { coordinates: [{ x: e.x, y: e.y }, { x: xAxis.convertToPixel(outcome.index), y: yAxis.convertToPixel(outcome.price) }] },
            styles: { style: 'dashed', size: 1, color, dashedValue: [4, 3] },
            ignoreEvent: true,
          })
        }
      }

      figures.push(
        label(`${take.toFixed(p)}  (${signed(stats.takePct, 2)}%)`, mid, tk.y, COLORS.up, 'center', edge(tk.y)),
        label(`${stop.toFixed(p)}  (${signed(stats.stopPct, 2)}%)`, mid, stopY, COLORS.down, 'center', edge(stopY)),
        label(`${entry.toFixed(p)}  R:R ${stats.rr === null ? '—' : stats.rr.toFixed(2)}`, mid, e.y, '#3a4350'),
      )
      return figures as ReturnType<NonNullable<OverlayTemplate['createPointFigures']>>
    },
  }
}

const priceRange: OverlayTemplate = {
  name: 'priceRange',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ overlay, coordinates, precision }) => {
    const pts = overlay.points
    if (coordinates.length < 2 || pts[0]?.value === undefined || pts[1]?.value === undefined) return []
    const [a, b] = coordinates
    const stats = priceRangeStats(pts[0].value, pts[1].value)
    const color = lineColor(overlay.styles, COLORS.accent)
    const x1 = Math.min(a.x, b.x)
    const x2 = Math.max(a.x, b.x, x1 + 60)
    const mid = (x1 + x2) / 2
    const head = b.y < a.y ? 6 : -6
    return [
      rect({ x: x1, y: a.y }, { x: x2, y: b.y }, 'rgba(76,141,255,0.12)'),
      { type: 'line', attrs: { coordinates: [{ x: mid, y: a.y }, { x: mid, y: b.y }] }, styles: { style: 'solid', size: 1, color } },
      {
        type: 'line',
        attrs: { coordinates: [{ x: mid - 4, y: b.y + head }, { x: mid, y: b.y }, { x: mid + 4, y: b.y + head }] },
        styles: { style: 'solid', size: 1, color },
        ignoreEvent: true,
      },
      label(`${signed(stats.delta, precision.price)}  (${signed(stats.pct, 2)}%)`, mid, b.y, color, 'center', b.y < a.y ? 'bottom' : 'top'),
    ]
  },
}

const dateRange: OverlayTemplate = {
  name: 'dateRange',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ overlay, coordinates, xAxis }) => {
    if (coordinates.length < 2) return []
    const [a, b] = coordinates
    const color = lineColor(overlay.styles, COLORS.accent)
    const i1 = xAxis?.convertFromPixel(a.x) ?? 0
    const i2 = xAxis?.convertFromPixel(b.x) ?? 0
    const bars = Math.round(i2 - i1)
    const interval = overlayContext.get(overlay.id)?.interval() ?? 0
    const y1 = Math.min(a.y, b.y)
    const y2 = Math.max(a.y, b.y, y1 + 40)
    const mid = (y1 + y2) / 2
    const head = b.x > a.x ? -6 : 6
    return [
      rect({ x: a.x, y: y1 }, { x: b.x, y: y2 }, 'rgba(76,141,255,0.12)'),
      { type: 'line', attrs: { coordinates: [{ x: a.x, y: mid }, { x: b.x, y: mid }] }, styles: { style: 'solid', size: 1, color } },
      {
        type: 'line',
        attrs: { coordinates: [{ x: b.x + head, y: mid - 4 }, { x: b.x, y: mid }, { x: b.x + head, y: mid + 4 }] },
        styles: { style: 'solid', size: 1, color },
        ignoreEvent: true,
      },
      label(`${bars} bars${interval ? `, ${formatDuration(bars * interval)}` : ''}`, (a.x + b.x) / 2, y2, color, 'center', 'top'),
    ]
  },
}

const text: OverlayTemplate = {
  name: 'text',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ overlay, coordinates }) => {
    if (coordinates.length < 1) return []
    const value = typeof overlay.extendData === 'string' && overlay.extendData ? overlay.extendData : 'Text'
    return [
      {
        type: 'text',
        attrs: { x: coordinates[0].x + 8, y: coordinates[0].y, text: value, align: 'left', baseline: 'middle' },
        styles: { style: 'fill', color: lineColor(overlay.styles, '#d6dbe2'), size: 13, family: FONT, weight: 'normal', backgroundColor: 'transparent' },
      },
    ]
  },
}

const arrow: OverlayTemplate = {
  name: 'arrow',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ overlay, coordinates }) => {
    if (coordinates.length < 2) return []
    const [a, b] = coordinates
    const styles = lineStyles(overlay.styles, COLORS.accent)
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    const size = 9 + styles.size * 2
    const wing = (offset: number) => ({ x: b.x - size * Math.cos(angle + offset), y: b.y - size * Math.sin(angle + offset) })
    return [
      { type: 'line', attrs: { coordinates: [a, b] }, styles },
      { type: 'polygon', attrs: { coordinates: [b, wing(0.4), wing(-0.4)] }, styles: { style: 'fill', color: styles.color } },
    ]
  },
}

/** Fibonacci channel levels (TradingView defaults). */
export const FIB_CHANNEL_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236]

/**
 * Fibonacci channel: click 1 and 2 set the base trend line, click 3 the channel width. Each level is a line
 * parallel to the base, shifted by `level × (vertical distance from the base to point 3)`.
 */
const fibonacciChannel: OverlayTemplate = {
  name: 'fibonacciChannel',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ overlay, coordinates, precision, yAxis }) => {
    if (coordinates.length < 2) return []
    const [a, b] = coordinates
    const styles = lineStyles(overlay.styles, COLORS.accent)
    if (coordinates.length < 3) return [{ type: 'line', attrs: { coordinates: [a, b] }, styles }]
    const c = coordinates[2]
    const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x)
    const dy = c.y - (a.y + slope * (c.x - a.x))
    const left = Math.min(a.x, b.x)
    const right = Math.max(a.x, b.x)
    const yAt = (x: number, shift: number) => a.y + slope * (x - a.x) + shift
    const figures: unknown[] = []
    for (const level of FIB_CHANNEL_LEVELS) {
      const y1 = yAt(left, level * dy)
      const y2 = yAt(right, level * dy)
      figures.push({ type: 'line', attrs: { coordinates: [{ x: left, y: y1 }, { x: right, y: y2 }] }, styles })
      const price = yAxis?.convertFromPixel(y1)
      figures.push({
        type: 'text',
        attrs: { x: left - 4, y: y1, text: `${level}${price === undefined ? '' : ` (${price.toFixed(precision.price)})`}`, align: 'right', baseline: 'middle' },
        styles: { style: 'fill', color: styles.color, size: 11, family: FONT, weight: 'normal', backgroundColor: 'transparent' },
        ignoreEvent: true,
      })
    }
    return figures as ReturnType<NonNullable<OverlayTemplate['createPointFigures']>>
  },
}

const CUSTOM_TEMPLATES: OverlayTemplate[] = [
  fibonacciChannel,
  positionTemplate('longPosition'),
  positionTemplate('shortPosition'),
  priceRange,
  dateRange,
  text,
  arrow,
]
const templateOf = (name: string) => CUSTOM_TEMPLATES.find((t) => t.name === name)

/** Every drawing tool offered in the toolbar (drawings.md §2). */
export const DRAWING_TOOLS: DrawingTool[] = [
  builtin('segment', 'Trend line', 'lines'),
  builtin('rayLine', 'Ray', 'lines'),
  builtin('straightLine', 'Extended line', 'lines'),
  builtin('horizontalStraightLine', 'Horizontal line', 'lines'),
  builtin('horizontalRayLine', 'Horizontal ray', 'lines'),
  builtin('horizontalSegment', 'Horizontal segment', 'lines'),
  builtin('verticalStraightLine', 'Vertical line', 'lines'),
  builtin('verticalRayLine', 'Vertical ray', 'lines'),
  builtin('verticalSegment', 'Vertical segment', 'lines'),
  builtin('priceLine', 'Price line', 'lines'),
  builtin('parallelStraightLine', 'Parallel channel', 'channels'),
  builtin('priceChannelLine', 'Price channel', 'channels'),
  builtin('fibonacciLine', 'Fibonacci retracement', 'fib'),
  { id: 'fibonacciChannel', label: 'Fibonacci channel', group: 'fib', template: templateOf('fibonacciChannel') },
  { id: 'longPosition', label: 'Long position', group: 'forecast', template: templateOf('longPosition') },
  { id: 'shortPosition', label: 'Short position', group: 'forecast', template: templateOf('shortPosition') },
  { id: 'priceRange', label: 'Price range', group: 'forecast', template: templateOf('priceRange') },
  { id: 'dateRange', label: 'Date range', group: 'forecast', template: templateOf('dateRange') },
  { id: 'text', label: 'Text', group: 'annotate', template: templateOf('text') },
  builtin('simpleAnnotation', 'Annotation', 'annotate'),
  builtin('simpleTag', 'Price tag', 'annotate'),
  { id: 'arrow', label: 'Arrow', group: 'annotate', template: templateOf('arrow') },
]

let registered = false
export function ensureOverlaysRegistered(): void {
  if (registered) return
  registered = true
  for (const tool of DRAWING_TOOLS) {
    if (tool.template) registerOverlay(tool.template as OverlayTemplate)
  }
}

// ---------- tool traits used by the UI ----------

/** Tools whose `extendData` is a text shown on the chart. */
const TEXT_TOOLS = new Set(['text', 'simpleAnnotation', 'simpleTag'])
export function drawingHasText(name: string): boolean {
  return TEXT_TOOLS.has(name)
}

/** Tools without a user-styleable line (they have their own fixed colours). */
const UNSTYLED = new Set(['longPosition', 'shortPosition'])
export function drawingHasLineStyle(name: string): boolean {
  return !UNSTYLED.has(name)
}

const LINE_KINDS: Record<string, LineKind> = {
  horizontalStraightLine: 'horizontal',
  horizontalRayLine: 'horizontal',
  horizontalSegment: 'horizontal',
  priceLine: 'horizontal',
  segment: 'segment',
  rayLine: 'ray',
  straightLine: 'straight',
}
/** How a drawing behaves as an alert line, or `null` when it cannot be used for a line-cross alert. */
export function drawingLineKind(shape: Pick<DrawingShape, 'name'>): LineKind | null {
  return LINE_KINDS[shape.name] ?? null
}

// ---------- style model ----------

/** Library-independent style of a drawing. */
export interface DrawingStyle {
  color: string
  width: number
  dashed: boolean
}

export const DEFAULT_DRAWING_STYLE: DrawingStyle = { color: COLORS.accent, width: 1, dashed: false }

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** DrawingStyle → the `styles` object stored on a DrawingShape (KLineChart OverlayStyle subset). */
export function toShapeStyles(style: DrawingStyle): Record<string, unknown> {
  const fill = withAlpha(style.color, 0.15)
  return {
    line: { color: style.color, size: style.width, style: style.dashed ? 'dashed' : 'solid', dashedValue: [4, 4] },
    polygon: { color: fill, borderColor: style.color },
    rect: { color: fill, borderColor: style.color },
    circle: { color: fill, borderColor: style.color },
    arc: { color: style.color },
    point: { color: style.color, activeColor: style.color, borderColor: withAlpha(style.color, 0.35), activeBorderColor: withAlpha(style.color, 0.35) },
    text: { backgroundColor: style.color, borderColor: style.color },
  }
}

export function fromShapeStyles(styles: Record<string, unknown> | undefined): DrawingStyle {
  const line = (styles?.line ?? {}) as { color?: string; size?: number; style?: string }
  return {
    color: line.color ?? DEFAULT_DRAWING_STYLE.color,
    width: line.size ?? DEFAULT_DRAWING_STYLE.width,
    dashed: line.style === 'dashed',
  }
}
