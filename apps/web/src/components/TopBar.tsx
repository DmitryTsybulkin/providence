import { useTranslation } from 'react-i18next'
import { LANGUAGES } from '../i18n'
import { useSettings } from '../state/settings'

export function TopBar() {
  const { t } = useTranslation()
  const language = useSettings((s) => s.language)
  const setLanguage = useSettings((s) => s.setLanguage)
  return (
    <header className="topbar">
      <span className="brand">Providence</span>
      <span className="grow" />
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
