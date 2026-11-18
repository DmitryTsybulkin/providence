import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { symbolKey, TIMEFRAMES, type DrawingShape } from '@providence/core'
import { adapter } from '../api/adapter'
import { createChartEngine, drawingHasText, type ChartEngine, type DrawingOptions } from '../chart'
import { CellController, type CellStatus } from '../lib/cellController'
import { formatPct, formatPrice, signClass } from '../lib/format'
import { shapeToLine, useAlerts } from '../state/alerts'
import { useDrawings } from '../state/drawings'
import { useLayout } from '../state/layout'
import { useMarket } from '../state/market'
import { useSettings } from '../state/settings'
import { useWsStatus } from '../state/ws'
import { DrawingStyleBar, DrawingToolbar } from './Drawings'
import { ExportMenu } from './ExportMenu'
import { GoToDate } from './GoToDate'
import { LayoutSwitcher } from './LayoutSwitcher'
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

  // Drawings
  const entry = useDrawings((s) => s.entries[key])
  const canUndo = useDrawings((s) => (s.undoStacks[key]?.length ?? 0) > 0)
  const [tool, setTool] = useState<string | null>(null)
  const [selected, setSelected] = useState<DrawingShape | null>(null)
  const [drawOptions, setDrawOptions] = useState<DrawingOptions>({ magnet: false, lockAll: false, hideAll: false })
  /** Name of an imported JSON file's symbol while it is being viewed instead of market data. */
  const [imported, setImported] = useState<string | null>(null)
  const keyRef = useRef(key)
  keyRef.current = key
  const appliedKey = useRef<string | null>(null)

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
    const offDrawings = engine.onDrawingEvent((e) => {
      if (e.type === 'change') useDrawings.getState().commit(keyRef.current, e.shapes, index)
      else if (e.type === 'select') setSelected(e.shape)
      else setTool(null)
    })
    return () => {
      offDrawings()
      appliedKey.current = null
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
    setImported(null)
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

  // Drawings are per symbol: load them, and re-apply whenever another cell or an undo changed them.
  useEffect(() => {
    void useDrawings.getState().ensureLoaded(key)
  }, [key])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const ownChange = entry?.origin === index && appliedKey.current === key
    appliedKey.current = key
    if (!ownChange) engine.setDrawings(entry?.shapes ?? [])
  }, [entry, key, index])

  useEffect(() => {
    engineRef.current?.setDrawingOptions(drawOptions)
  }, [drawOptions])

  const pickTool = (toolId: string | null) => {
    const engine = engineRef.current
    if (!engine) return
    if (toolId === null) {
      engine.cancelDrawing()
      setTool(null)
      return
    }
    const started = engine.startDrawing(toolId, drawingHasText(toolId) ? t('drawings.defaultText') : undefined)
    setTool(started ? toolId : null)
  }

  // Keyboard: Delete removes the selected drawing, Esc cancels the tool, Ctrl/Cmd+Z undoes (active cell only).
  const selectedId = selected?.id ?? null
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useLayout.getState().active !== index) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      const engine = engineRef.current
      if (!engine) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        engine.removeDrawing(selectedId)
      } else if (e.key === 'Escape') {
        engine.cancelDrawing()
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        useDrawings.getState().undo(keyRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, selectedId])

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
        <ExportMenu
          getEngine={() => engineRef.current}
          symbol={imported ?? cell.symbol}
          category={cell.category}
          tf={cell.tf}
          onImport={(chart) => {
            setImported(chart.symbol)
            void ctrlRef.current?.showStatic(chart.candles)
          }}
        />
        {/* The layout belongs to the whole grid, so only the first cell shows the switcher. */}
        {index === 0 && <LayoutSwitcher />}
        <span className="grow" />
        {imported && (
          <>
            <span className="badge warn">{t('export.viewing', { name: imported })}</span>
            <button
              className="tool-btn"
              onClick={() => {
                setImported(null)
                void ctrlRef.current?.show({ symbolKey: key, tf: cell.tf })
              }}
            >
              {t('export.close')}
            </button>
          </>
        )}
        {wsStatus === 'reconnecting' && <span className="badge warn">{t('chart.reconnecting')}</span>}
        {!imported && !status.live && !status.loading && !status.error && (
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
        <DrawingToolbar
          tool={tool}
          options={drawOptions}
          canUndo={canUndo}
          hasDrawings={(entry?.shapes.length ?? 0) > 0}
          onPick={pickTool}
          onOptions={(patch) => setDrawOptions((o) => ({ ...o, ...patch }))}
          onUndo={() => useDrawings.getState().undo(key)}
          onClear={() => {
            engineRef.current?.setDrawings([])
            useDrawings.getState().commit(key, [], index)
          }}
        />
        <div className="chart-canvas" ref={containerRef} />
        {selected && (
          <DrawingStyleBar
            shape={selected}
            onPatch={(patch) => engineRef.current?.updateDrawing(selected.id, patch)}
            onDelete={() => engineRef.current?.removeDrawing(selected.id)}
            onAlert={() => {
              const line = shapeToLine(selected)
              if (line) useAlerts.getState().openDraft({ type: 'line', category: cell.category, symbol: cell.symbol, condition: 'cross', trigger: 'once', line })
            }}
          />
        )}
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
