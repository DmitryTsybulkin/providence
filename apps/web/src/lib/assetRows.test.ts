import { describe, expect, it } from 'vitest'
import type { SymbolInfo, Ticker } from '@providence/core'
import { buildAssetRows } from './assetRows'

const sym = (symbol: string, baseCoin: string): SymbolInfo => ({
  key: `linear:${symbol}`, category: 'linear', symbol, baseCoin, quoteCoin: 'USDT', tickSize: 0.1, pricePrecision: 1,
  volumePrecision: 3, status: 'Trading',
})
const tick = (symbol: string, turnover24h: number, change24h: number): Ticker => ({
  key: `linear:${symbol}`, category: 'linear', symbol, lastPrice: 1, change24h, high24h: 1, low24h: 1, turnover24h,
  volume24h: 1,
})
const symbols = [sym('BTCUSDT', 'BTC'), sym('ETHUSDT', 'ETH'), sym('1000PEPEUSDT', '1000PEPE'), sym('NEWUSDT', 'NEW')]
const tickers = Object.fromEntries(
  [tick('BTCUSDT', 300, 0.01), tick('ETHUSDT', 200, -0.02), tick('1000PEPEUSDT', 100, 0.05)].map((t) => [t.key, t]),
)
const base = { symbols, tickers, favourites: ['linear:ETHUSDT'], search: '', favOnly: false }
const names = (rows: ReturnType<typeof buildAssetRows>) => rows.map((r) => r.info.symbol)

describe('buildAssetRows', () => {
  const noFav = { ...base, favourites: [] }
  it('sorts by a ticker column; rows without a ticker go last in both directions', () => {
    expect(names(buildAssetRows({ ...noFav, sort: { column: 'turnover24h', dir: 'desc' } }))).toEqual(
      ['BTCUSDT', 'ETHUSDT', '1000PEPEUSDT', 'NEWUSDT'],
    )
    expect(names(buildAssetRows({ ...noFav, sort: { column: 'change24h', dir: 'asc' } }))).toEqual(
      ['ETHUSDT', 'BTCUSDT', '1000PEPEUSDT', 'NEWUSDT'],
    )
  })
  it('sorts by symbol', () => {
    expect(names(buildAssetRows({ ...noFav, sort: { column: 'symbol', dir: 'asc' } }))[0]).toBe('1000PEPEUSDT')
  })
  it('keeps favourites on top whatever the sort', () => {
    const favs = { ...base, favourites: ['linear:ETHUSDT', 'linear:NEWUSDT'] }
    expect(names(buildAssetRows({ ...favs, sort: { column: 'turnover24h', dir: 'desc' } }))).toEqual(
      ['ETHUSDT', 'NEWUSDT', 'BTCUSDT', '1000PEPEUSDT'],
    )
    expect(names(buildAssetRows({ ...favs, sort: { column: 'symbol', dir: 'desc' } }))).toEqual(
      ['NEWUSDT', 'ETHUSDT', 'BTCUSDT', '1000PEPEUSDT'],
    )
  })
  it('searches by symbol or base coin, case-insensitive', () => {
    const sort = { column: 'symbol', dir: 'asc' } as const
    expect(names(buildAssetRows({ ...base, sort, search: ' pepe ' }))).toEqual(['1000PEPEUSDT'])
    expect(names(buildAssetRows({ ...base, sort, search: 'usdt' }))).toHaveLength(4)
    expect(names(buildAssetRows({ ...base, sort, search: 'zzz' }))).toEqual([])
  })
  it('filters favourites and marks them', () => {
    const rows = buildAssetRows({ ...base, sort: { column: 'symbol', dir: 'asc' }, favOnly: true })
    expect(names(rows)).toEqual(['ETHUSDT'])
    expect(rows[0].favourite).toBe(true)
  })
})
