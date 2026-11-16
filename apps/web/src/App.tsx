import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Banner } from './components/Banner'
import { TopBar } from './components/TopBar'
import { AssetList } from './panels/AssetList'
import { boot, useBoot } from './state/boot'
import { useLayout } from './state/layout'
import { startTickerPolling, useMarket } from './state/market'

export function App() {
  const { t } = useTranslation()
  const ready = useBoot((s) => s.hydrated || s.serverDown)
  const hydrated = useBoot((s) => s.hydrated)

  useEffect(() => {
    void boot()
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const m = useMarket.getState()
    void m.refreshSymbols(m.category)
    void m.refreshTickers()
    return startTickerPolling()
  }, [hydrated])

  const cell = useLayout((s) => s.cells[s.active])

  return (
    <div className="app">
      <TopBar />
      <Banner />
      {ready ? (
        <main className="workspace">
          <AssetList />
          <section className="charts">
            <div className="empty muted">
              {cell.category}:{cell.symbol} · {cell.tf}
            </div>
          </section>
        </main>
      ) : (
        <div className="empty muted">{t('app.loading')}</div>
      )}
    </div>
  )
}
