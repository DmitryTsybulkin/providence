import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CATEGORIES } from '@providence/core'
import { buildAssetRows } from '../lib/assetRows'
import { formatCompact, formatPct, formatPrice, signClass } from '../lib/format'
import { useLayout } from '../state/layout'
import { useMarket, type SortColumn } from '../state/market'

const ROW_HEIGHT = 26

export function AssetList() {
  const { t } = useTranslation()
  const category = useMarket((s) => s.category)
  const symbols = useMarket((s) => s.symbols[s.category])
  const tickers = useMarket((s) => s.tickers)
  const favourites = useMarket((s) => s.favourites)
  const search = useMarket((s) => s.search)
  const favOnly = useMarket((s) => s.favOnly)
  const sort = useMarket((s) => s.sort)
  const loading = useMarket((s) => s.loading)
  const { setCategory, setSearch, setFavOnly, toggleSort, toggleFavourite } = useMarket.getState()

  const activeCell = useLayout((s) => s.cells[s.active])
  const activeKey = `${activeCell.category}:${activeCell.symbol}`

  const rows = useMemo(
    () => buildAssetRows({ symbols, tickers, favourites, search, favOnly, sort }),
    [symbols, tickers, favourites, search, favOnly, sort],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const columns: SortColumn[] = ['symbol', 'lastPrice', 'change24h', 'turnover24h', 'volume24h']
  if (category === 'linear') columns.push('fundingRate')
  const gridClass = `asset-grid ${category}`

  return (
    <section className="panel asset-list" aria-label={t('assets.title')}>
      <div className="panel-head">
        <div className="tabs" role="tablist">
          {CATEGORIES.map((c) => (
            <button key={c} role="tab" aria-selected={c === category} className={c === category ? 'tab active' : 'tab'} onClick={() => setCategory(c)}>
              {t(`category.${c}`)}
            </button>
          ))}
        </div>
        <span className="muted small">{t('assets.count', { count: rows.length })}</span>
      </div>
      <div className="asset-tools">
        <input
          className="input grow"
          type="search"
          placeholder={t('assets.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
        <button
          className={favOnly ? 'icon-btn active' : 'icon-btn'}
          title={t('assets.favOnly')}
          aria-pressed={favOnly}
          onClick={() => setFavOnly(!favOnly)}
        >
          ★
        </button>
      </div>
      <div className={`${gridClass} asset-header`} role="row">
        <span />
        {columns.map((col) => (
          <button
            key={col}
            className={col === 'symbol' ? 'th left' : 'th'}
            onClick={() => toggleSort(col)}
            aria-sort={sort.column === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
          >
            {t(`assets.col.${col}`)}
            <span className="sort-mark">{sort.column === col ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
          </button>
        ))}
      </div>
      <div className="asset-scroll" ref={scrollRef}>
        {rows.length === 0 ? (
          <div className="empty muted">{loading ? t('app.loading') : t('assets.empty')}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const { info, ticker, favourite } = rows[item.index]
              const selected = info.key === activeKey
              return (
                <div
                  key={info.key}
                  role="row"
                  aria-selected={selected}
                  className={`${gridClass} asset-row${selected ? ' selected' : ''}`}
                  style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                  onClick={() => {
                    const l = useLayout.getState()
                    l.setSymbol(l.active, info.category, info.symbol)
                  }}
                >
                  <button
                    className={favourite ? 'star on' : 'star'}
                    title={favourite ? t('assets.removeFav') : t('assets.addFav')}
                    aria-pressed={favourite}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFavourite(info.key)
                    }}
                  >
                    {favourite ? '★' : '☆'}
                  </button>
                  <span className="sym">{info.symbol}</span>
                  <span className="num">{ticker ? formatPrice(ticker.lastPrice, info.pricePrecision) : '—'}</span>
                  <span className={`num ${ticker ? signClass(ticker.change24h) : ''}`}>{ticker ? formatPct(ticker.change24h) : '—'}</span>
                  <span className="num">{ticker ? formatCompact(ticker.turnover24h) : '—'}</span>
                  <span className="num">{ticker ? formatCompact(ticker.volume24h) : '—'}</span>
                  {category === 'linear' && (
                    <span className={`num ${ticker?.fundingRate !== undefined ? signClass(ticker.fundingRate) : ''}`}>
                      {ticker?.fundingRate !== undefined ? formatPct(ticker.fundingRate, 4) : '—'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
