import { KLineEngine } from './klineEngine'
import type { ChartEngine, ChartEngineOptions } from './types'

export type * from './types'

export function createChartEngine(container: HTMLElement, options: ChartEngineOptions): ChartEngine {
  return new KLineEngine(container, options)
}

export { getIndicatorDef, indicatorCaption, listIndicatorDefs } from './indicators'
export {
  DEFAULT_DRAWING_STYLE, DRAWING_TOOLS, drawingHasLineStyle, drawingHasText, drawingLineKind, fromShapeStyles,
  toShapeStyles, type DrawingStyle,
} from './overlays'
