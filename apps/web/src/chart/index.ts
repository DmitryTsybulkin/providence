import { KLineEngine } from './klineEngine'
import type { ChartEngine, ChartEngineOptions } from './types'

export type * from './types'

export function createChartEngine(container: HTMLElement, options: ChartEngineOptions): ChartEngine {
  return new KLineEngine(container, options)
}
