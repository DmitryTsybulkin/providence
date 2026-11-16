import { useTranslation } from 'react-i18next'

export function App() {
  const { t } = useTranslation()
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Providence</span>
        <span className="muted">{t('app.tagline')}</span>
      </header>
    </div>
  )
}
