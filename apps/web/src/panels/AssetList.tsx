import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CATEGORIES } from '@providence/core'
import { buildAssetRows } from '../lib/assetRows'
import { formatCompact, formatPct, formatPrice, signClass } from '../lib/format'
import { useLayout } from '../state/layout'
import { Popover } from '../components/Popover'
import { OPTIONAL_COLUMNS, useMarket, type SortColumn } from '../state/market'

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
  const shown = useMarket((s) => s.columns)
  const { setCategory, setSearch, setFavOnly, toggleSort, toggleFavourite, toggleColumn } = useMarket.getState()
  const [colsOpen, setColsOpen] = useState(false)

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

  const showTurnover = shown.includes('turnover24h')
  const showFunding = category === 'linear' && shown.includes('fundingRate')
  const columns: SortColumn[] = ['symbol', 'lastPrice', 'change24h']
  if (showTurnover) columns.push('turnover24h')
  columns.push('volume24h')
  if (showFunding) columns.push('fundingRate')
  const WIDTH: Record<SortColumn, string> = {
    symbol: 'minmax(96px, 1.5fr)', lastPrice: '1.1fr', change24h: '58px', turnover24h: '62px', volume24h: '62px', fundingRate: '74px',
  }
  const gridStyle = { gridTemplateColumns: ['22px', ...columns.map((c) => WIDTH[c])].join(' ') }
  const panelWidth = 330 + (showTurnover ? 68 : 0) + (showFunding ? 80 : 0)
  const gridClass = 'asset-grid'

  return (
    <section className="panel asset-list" style={{ width: panelWidth }} aria-label={t('assets.title')}>
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
        <div className="anchor">
          <button className={colsOpen ? 'icon-btn on' : 'icon-btn'} title={t('assets.columns')} aria-haspopup="menu" onClick={() => setColsOpen(!colsOpen)}>
            ⋮
          </button>
          {colsOpen && (
            <Popover onClose={() => setColsOpen(false)} className="menu right">
              <div className="menu-title">{t('assets.columns')}</div>
              {OPTIONAL_COLUMNS.map((c) => (
                <button
                  key={c}
                  className={shown.includes(c) ? 'menu-item checked' : 'menu-item'}
                  role="menuitemcheckbox"
                  aria-checked={shown.includes(c)}
                  onClick={() => toggleColumn(c)}
                >
                  <span className="check">{shown.includes(c) ? '✓' : ''}</span>
                  {t(`assets.col.${c}`)}
                  {c === 'fundingRate' && <span className="muted small">&nbsp;({t('category.linear')})</span>}
                </button>
              ))}
            </Popover>
          )}
        </div>
      </div>
      <div className={`${gridClass} asset-header`} style={gridStyle} role="row">
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
                  style={{ ...gridStyle, transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
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
                  {showTurnover && <span className="num">{ticker ? formatCompact(ticker.turnover24h) : '—'}</span>}
                  <span className="num">{ticker ? formatCompact(ticker.volume24h) : '—'}</span>
                  {showFunding && (
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
