import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'
import { LANGUAGES } from '../i18n'
import { useAlerts } from '../state/alerts'
import { LAYOUT_MODES, useLayout, type LayoutMode } from '../state/layout'
import { useSettings } from '../state/settings'

function LayoutIcon({ mode }: { mode: LayoutMode }) {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1" y="1" width="14" height="12" rx="1.5" />
      {mode >= 2 && <path d="M8 1v12" />}
      {mode === 4 && <path d="M1 7h14" />}
    </svg>
  )
}

export function TopBar() {
  const { t } = useTranslation()
  const language = useSettings((s) => s.language)
  const setLanguage = useSettings((s) => s.setLanguage)
  const mode = useLayout((s) => s.mode)
  const setMode = useLayout((s) => s.setMode)
  const alertsOpen = useAlerts((s) => s.panelOpen)
  const activeAlerts = useAlerts((s) => s.alerts.filter((a) => a.status === 'active').length)
  const eventsUp = useAlerts((s) => s.connected)
  return (
    <header className="topbar">
      <span className="brand">Providence</span>
      <div className="seg" role="group" aria-label={t('topbar.layout')}>
        {LAYOUT_MODES.map((m) => (
          <button
            key={m}
            className={m === mode ? 'seg-btn icon active' : 'seg-btn icon'}
            title={t(`topbar.layout${m}`)}
            aria-pressed={m === mode}
            onClick={() => setMode(m)}
          >
            <LayoutIcon mode={m} />
          </button>
        ))}
      </div>
      <span className="grow" />
      <button
        className={alertsOpen ? 'tool-btn with-icon active' : 'tool-btn with-icon'}
        aria-pressed={alertsOpen}
        title={eventsUp ? t('alerts.title') : t('alerts.paused')}
        onClick={() => useAlerts.getState().togglePanel()}
      >
        <Icon name="bell" />
        {t('alerts.title')}
        {activeAlerts > 0 && <span className="count">{activeAlerts}</span>}
        {!eventsUp && <span className="dot warn" />}
      </button>
      <div className="seg" role="group" aria-label={t('topbar.language')}>
        {LANGUAGES.map((l) => (
          <button key={l} className={l === language ? 'seg-btn active' : 'seg-btn'} onClick={() => setLanguage(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  )
}
