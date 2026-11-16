import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { symbolKey, TIMEFRAMES } from '@providence/core'
import { adapter } from '../api/adapter'
import { createChartEngine, type ChartEngine } from '../chart'
import { CellController, type CellStatus } from '../lib/cellController'
import { formatPct, formatPrice, signClass } from '../lib/format'
import { useLayout } from '../state/layout'
import { useMarket } from '../state/market'
import { useSettings } from '../state/settings'
import { useWsStatus } from '../state/ws'
import { GoToDate } from './GoToDate'
import { IndicatorChips, IndicatorPicker } from './Indicators'

/** Dev-only handle for poking at charts from the browser console: `__providence.cells[0].engine`. */
const debugCells: Record<number, { engine: ChartEngine; ctrl: CellController }> = {}
if (import.meta.env.DEV) (window as unknown as { __providence: unknown }).__providence = { cells: debugCells }

const INITIAL_STATUS: CellStatus = { loading: true, error: null, live: false, empty: false }

export function ChartCell({ index }: { index: number }) {
  const { t } = useTranslation()
  const cell = useLayout((s) => s.cells[index])
  const key = symbolKey(cell.category, cell.symbol)
  const info = useMarket((s) => s.symbolIndex[key])
  const ticker = useMarket((s) => s.tickers[key])
  const language = useSettings((s) => s.language)
  const wsStatus = useWsStatus((s) => s[cell.category])

  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<ChartEngine | null>(null)
  const ctrlRef = useRef<CellController | null>(null)
  const shown = useRef<string | null>(null)
  const [status, setStatus] = useState<CellStatus>(INITIAL_STATUS)

  // Engine lifecycle
  useEffect(() => {
    const el = containerRef.current!
    const engine = createChartEngine(el, { locale: useSettings.getState().language })
    const ctrl = new CellController(engine, adapter, setStatus)
    engineRef.current = engine
    ctrlRef.current = ctrl
    if (import.meta.env.DEV) debugCells[index] = { engine, ctrl }
    const observer = new ResizeObserver(() => engine.resize())
    observer.observe(el)
    return () => {
      observer.disconnect()
      ctrl.dispose()
      engine.dispose()
      engineRef.current = null
      ctrlRef.current = null
      shown.current = null
    }
  }, [index])

  // Series: symbol or timeframe changed
  useEffect(() => {
    const engine = engineRef.current
    const ctrl = ctrlRef.current
    if (!engine || !ctrl) return
    // chart.md §4: a timeframe switch keeps the current right-edge time in view.
    const keep = shown.current === key ? engine.getRightEdgeTime() : null
    shown.current = key
    void ctrl.show({ symbolKey: key, tf: cell.tf }, keep)
  }, [key, cell.tf])

  useEffect(() => {
    if (info) engineRef.current?.setPrecision(info.pricePrecision, info.volumePrecision)
    else void useMarket.getState().refreshSymbols(cell.category)
  }, [info, cell.category])

  useEffect(() => {
    engineRef.current?.setLocale(language)
  }, [language])

  useEffect(() => {
    engineRef.current?.setIndicators(cell.indicators)
  }, [cell.indicators])

  const { setTf } = useLayout.getState()

  return (
    <div className="chart-cell">
      <div className="chart-head">
        <span className="chart-symbol">{cell.symbol}</span>
        <span className="tag">{t(`category.${cell.category}`)}</span>
        {ticker && (
          <span className="chart-quote num">
            {formatPrice(ticker.lastPrice, info?.pricePrecision ?? 2)}{' '}
            <span className={signClass(ticker.change24h)}>{formatPct(ticker.change24h)}</span>
          </span>
        )}
        <div className="seg" role="group" aria-label={t('chart.timeframe')}>
          {TIMEFRAMES.map((tf) => (
            <button key={tf} className={tf === cell.tf ? 'seg-btn active' : 'seg-btn'} onClick={() => setTf(index, tf)}>
              {tf}
            </button>
          ))}
        </div>
        <IndicatorPicker index={index} />
        <GoToDate onGo={(time) => void ctrlRef.current?.goTo(time)} />
        <span className="grow" />
        {wsStatus === 'reconnecting' && <span className="badge warn">{t('chart.reconnecting')}</span>}
        {!status.live && !status.loading && !status.error && (
          <>
            <span className="badge" title={t('chart.historyHint')}>
              {t('chart.history')}
            </span>
            <button className="tool-btn" onClick={() => void ctrlRef.current?.goLive()}>
              {t('chart.toNow')} →
            </button>
          </>
        )}
      </div>
      <IndicatorChips index={index} />
      <div className="chart-body">
        <div className="chart-canvas" ref={containerRef} />
        {(status.loading || status.error || status.empty) && (
          <div className={`chart-overlay${status.loading ? ' passive' : ''}`}>
            {status.loading ? (
              <span className="muted">{t('chart.loading')}</span>
            ) : status.error ? (
              <div className="stack center">
                <span>{t('chart.error')}</span>
                <span className="muted small">{status.error}</span>
                <button className="btn" onClick={() => void ctrlRef.current?.reload()}>
                  {t('chart.retry')}
                </button>
              </div>
            ) : (
              <span className="muted">{t('chart.noData')}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
