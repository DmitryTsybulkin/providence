import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'
import { LANGUAGES } from '../i18n'
import { useAlerts } from '../state/alerts'
import { useSettings } from '../state/settings'

export function TopBar() {
  const { t } = useTranslation()
  const language = useSettings((s) => s.language)
  const setLanguage = useSettings((s) => s.setLanguage)
  const alertsOpen = useAlerts((s) => s.panelOpen)
  const activeAlerts = useAlerts((s) => s.alerts.filter((a) => a.status === 'active').length)
  const eventsUp = useAlerts((s) => s.connected)
  return (
    <header className="topbar">
      <span className="brand">Providence</span>
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
