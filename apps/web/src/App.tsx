import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Banner } from './components/Banner'
import { ChartGrid } from './components/ChartGrid'
import { TopBar } from './components/TopBar'
import { AlertDialog, AlertsPanel, Toasts } from './panels/AlertsPanel'
import { AssetList } from './panels/AssetList'
import { connectEvents, useAlerts } from './state/alerts'
import { boot, useBoot } from './state/boot'
import { startTickerPolling, useMarket } from './state/market'

export function App() {
  const { t } = useTranslation()
  const ready = useBoot((s) => s.hydrated || s.serverDown)
  const hydrated = useBoot((s) => s.hydrated)

  const alertsOpen = useAlerts((s) => s.panelOpen)

  useEffect(() => {
    void boot()
    return connectEvents()
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const m = useMarket.getState()
    void m.refreshSymbols(m.category)
    void m.refreshTickers()
    return startTickerPolling()
  }, [hydrated])

  return (
    <div className="app">
      <TopBar />
      <Banner />
      {ready ? (
        <main className="workspace">
          <AssetList />
          <ChartGrid />
          {alertsOpen && <AlertsPanel />}
        </main>
      ) : (
        <div className="empty muted">{t('app.loading')}</div>
      )}
      <AlertDialog />
      <Toasts />
    </div>
  )
}
