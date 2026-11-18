import { create } from 'zustand'
import type { RestStatus } from '@providence/adapter-bybit'
import type { Category, SymbolInfo, SymbolKey, Ticker } from '@providence/core'
import { adapter } from '../api/adapter'
import { createSaver, loadKey } from '../api/store'

export type SortColumn = 'symbol' | 'lastPrice' | 'change24h' | 'turnover24h' | 'volume24h' | 'fundingRate'
export interface SortState {
  column: SortColumn
  dir: 'asc' | 'desc'
}

/** market-data §7 */
export const DEFAULT_FAVOURITES: SymbolKey[] = ['linear:BTCUSDT', 'linear:ETHUSDT']
export const TICKER_REFRESH_MS = 5_000

/** Columns the user can switch on; the rest are always shown. */
export const OPTIONAL_COLUMNS = ['turnover24h', 'fundingRate'] as const
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]

interface ListPrefs {
  category: Category
  sort: SortState
  favOnly: boolean
  /** Optional columns that are shown; none by default */
  columns: OptionalColumn[]
}

interface MarketState extends ListPrefs {
  symbols: Record<Category, SymbolInfo[]>
  symbolIndex: Record<string, SymbolInfo>
  tickers: Record<string, Ticker>
  favourites: SymbolKey[]
  search: string
  /** Outcome of the last REST call; null until the first one. */
  rest: RestStatus | null
  loading: boolean

  setCategory(c: Category): void
  setSearch(s: string): void
  toggleSort(column: SortColumn): void
  setFavOnly(v: boolean): void
  toggleColumn(c: OptionalColumn): void
  toggleFavourite(key: SymbolKey): void
  refreshSymbols(category: Category): Promise<void>
  refreshTickers(): Promise<void>
  hydrate(prefs: Partial<ListPrefs> | undefined, favourites: SymbolKey[] | undefined): void
}

const favSaver = createSaver<SymbolKey[]>('favourites')
const prefsSaver = createSaver<ListPrefs>('assetList')

export const useMarket = create<MarketState>((set, get) => {
  const savePrefs = () => {
    const { category, sort, favOnly, columns } = get()
    prefsSaver.save({ category, sort, favOnly, columns })
  }
  return {
    category: 'linear',
    sort: { column: 'volume24h', dir: 'desc' },
    favOnly: false,
    columns: [],
    symbols: { linear: [], spot: [] },
    symbolIndex: {},
    tickers: {},
    favourites: DEFAULT_FAVOURITES,
    search: '',
    rest: null,
    loading: false,

    setCategory(category) {
      set({ category })
      savePrefs()
      void get().refreshSymbols(category)
      void get().refreshTickers()
    },
    setSearch: (search) => set({ search }),
    toggleSort(column) {
      const cur = get().sort
      const dir = cur.column === column ? (cur.dir === 'asc' ? 'desc' : 'asc') : column === 'symbol' ? 'asc' : 'desc'
      set({ sort: { column, dir } })
      savePrefs()
    },
    setFavOnly(favOnly) {
      set({ favOnly })
      savePrefs()
    },
    toggleColumn(column) {
      const cur = get().columns
      const columns = cur.includes(column) ? cur.filter((c) => c !== column) : [...cur, column]
      // Hiding the sorted column falls back to the default sort.
      const sort = !columns.includes(column) && get().sort.column === column ? { column: 'volume24h' as const, dir: 'desc' as const } : get().sort
      set({ columns, sort })
      savePrefs()
    },
    toggleFavourite(key) {
      const cur = get().favourites
      const favourites = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
      set({ favourites })
      favSaver.save(favourites)
    },

    async refreshSymbols(category) {
      if (get().symbols[category].length === 0) set({ loading: true })
      try {
        const list = await adapter.listSymbols(category)
        set((s) => {
          const symbolIndex = { ...s.symbolIndex }
          for (const info of list) symbolIndex[info.key] = info
          return { symbols: { ...s.symbols, [category]: list }, symbolIndex }
        })
      } catch {
        // status is reported through adapter.onRestStatus
      } finally {
        set({ loading: false })
      }
    },

    async refreshTickers() {
      const category = get().category
      try {
        const list = await adapter.getTickers(category)
        set((s) => {
          const tickers = { ...s.tickers }
          for (const t of list) tickers[t.key] = t
          return { tickers }
        })
      } catch {
        // keep the last known tickers; the banner explains why they are stale
      }
    },

    hydrate(prefs, favourites) {
      set({
        ...(prefs?.category ? { category: prefs.category } : {}),
        ...(prefs?.sort ? { sort: prefs.sort } : {}),
        ...(prefs?.favOnly !== undefined ? { favOnly: prefs.favOnly } : {}),
        ...(Array.isArray(prefs?.columns)
          ? { columns: prefs.columns.filter((c): c is OptionalColumn => (OPTIONAL_COLUMNS as readonly string[]).includes(c)) }
          : {}),
        ...(favourites ? { favourites } : {}),
      })
      favSaver.enable()
      prefsSaver.enable()
    },
  }
})

adapter.onRestStatus((rest) => useMarket.setState({ rest }))

export async function loadMarketPrefs() {
  const [prefs, favourites] = await Promise.all([
    loadKey<Partial<ListPrefs>>('assetList'),
    loadKey<SymbolKey[]>('favourites'),
  ])
  useMarket.getState().hydrate(prefs, favourites)
}

/** Polls tickers every 5 s while the tab is visible. Returns a stop function. */
export function startTickerPolling(): () => void {
  const tick = () => {
    if (document.visibilityState === 'visible') void useMarket.getState().refreshTickers()
  }
  const timer = setInterval(tick, TICKER_REFRESH_MS)
  document.addEventListener('visibilitychange', tick)
  // Symbols are cached for 1 h on the server; refresh hourly to pick up new listings.
  const symbolTimer = setInterval(() => void useMarket.getState().refreshSymbols(useMarket.getState().category), 60 * 60_000)
  return () => {
    clearInterval(timer)
    clearInterval(symbolTimer)
    document.removeEventListener('visibilitychange', tick)
  }
}
