import { create } from 'zustand'
import { TIMEFRAMES, type Category, type ChartState, type IndicatorState, type Timeframe } from '@providence/core'
import { createSaver, loadKey } from '../api/store'

export type LayoutMode = 1 | 2 | 4
export const LAYOUT_MODES: LayoutMode[] = [1, 2, 4]
export const MAX_CELLS = 4
/** chart.md §4 */
export const MAX_INDICATORS = 10

interface SavedLayout {
  mode: LayoutMode
  active: number
  cells: ChartState[]
}

interface LayoutState extends SavedLayout {
  setMode(mode: LayoutMode): void
  setActive(index: number): void
  setSymbol(index: number, category: Category, symbol: string): void
  setTf(index: number, tf: Timeframe): void
  setIndicators(index: number, indicators: IndicatorState[]): void
  hydrate(saved: Partial<SavedLayout> | undefined): void
}

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT']

export function defaultCell(i: number): ChartState {
  return {
    category: 'linear',
    symbol: DEFAULT_SYMBOLS[i % DEFAULT_SYMBOLS.length],
    tf: '1h',
    indicators: [{ id: 'volume', params: {}, visible: true }],
  }
}

function sanitizeCell(c: Partial<ChartState> | undefined, i: number): ChartState {
  const d = defaultCell(i)
  if (!c || typeof c.symbol !== 'string') return d
  return {
    category: c.category === 'spot' ? 'spot' : 'linear',
    symbol: c.symbol,
    tf: TIMEFRAMES.includes(c.tf as Timeframe) ? (c.tf as Timeframe) : d.tf,
    indicators: Array.isArray(c.indicators)
      ? c.indicators
          .filter((x) => x && typeof x.id === 'string')
          .slice(0, MAX_INDICATORS)
          .map((x) => ({ id: x.id, params: x.params ?? {}, visible: x.visible !== false }))
      : d.indicators,
  }
}

const saver = createSaver<SavedLayout>('layout')

export const useLayout = create<LayoutState>((set, get) => {
  const update = (index: number, patch: Partial<ChartState>) => {
    set((s) => ({ cells: s.cells.map((c, i) => (i === index ? { ...c, ...patch } : c)) }))
    persist()
  }
  const persist = () => {
    const { mode, active, cells } = get()
    saver.save({ mode, active, cells })
  }
  return {
    mode: 1,
    active: 0,
    cells: Array.from({ length: MAX_CELLS }, (_, i) => defaultCell(i)),

    setMode(mode) {
      set((s) => ({ mode, active: Math.min(s.active, mode - 1) }))
      persist()
    },
    setActive(index) {
      if (index === get().active || index >= get().mode) return
      set({ active: index })
      persist()
    },
    setSymbol: (index, category, symbol) => update(index, { category, symbol }),
    setTf: (index, tf) => update(index, { tf }),
    setIndicators: (index, indicators) => update(index, { indicators }),

    hydrate(saved) {
      if (saved) {
        const mode: LayoutMode = LAYOUT_MODES.includes(saved.mode as LayoutMode) ? (saved.mode as LayoutMode) : 1
        set({
          mode,
          active: Math.min(Math.max(0, saved.active ?? 0), mode - 1),
          cells: Array.from({ length: MAX_CELLS }, (_, i) => sanitizeCell(saved.cells?.[i], i)),
        })
      }
      saver.enable()
    },
  }
})

export async function loadLayout() {
  useLayout.getState().hydrate(await loadKey<Partial<SavedLayout>>('layout'))
}
