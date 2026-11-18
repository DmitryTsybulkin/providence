import type { SymbolInfo, Ticker } from '@providence/core'
import type { SortState } from '../state/market'

export interface AssetRow {
  info: SymbolInfo
  ticker: Ticker | undefined
  favourite: boolean
}

export interface RowsInput {
  symbols: SymbolInfo[]
  tickers: Record<string, Ticker>
  favourites: readonly string[]
  search: string
  favOnly: boolean
  sort: SortState
}

/** Join symbols with tickers, then filter and sort for the asset table. Pure. */
export function buildAssetRows(p: RowsInput): AssetRow[] {
  const fav = new Set(p.favourites)
  const q = p.search.trim().toUpperCase()
  const rows: AssetRow[] = []
  for (const info of p.symbols) {
    const favourite = fav.has(info.key)
    if (p.favOnly && !favourite) continue
    if (q && !info.symbol.includes(q) && !info.baseCoin.toUpperCase().includes(q)) continue
    rows.push({ info, ticker: p.tickers[info.key], favourite })
  }
  const { column, dir } = p.sort
  const sign = dir === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    // Favourites always stay on top; the chosen sort applies within each group.
    if (a.favourite !== b.favourite) return a.favourite ? -1 : 1
    if (column === 'symbol') return sign * a.info.symbol.localeCompare(b.info.symbol)
    const av = a.ticker?.[column]
    const bv = b.ticker?.[column]
    // Rows without a value always go last, whatever the direction.
    if (av === undefined && bv === undefined) return a.info.symbol.localeCompare(b.info.symbol)
    if (av === undefined) return 1
    if (bv === undefined) return -1
    return av === bv ? a.info.symbol.localeCompare(b.info.symbol) : sign * (av - bv)
  })
  return rows
}
