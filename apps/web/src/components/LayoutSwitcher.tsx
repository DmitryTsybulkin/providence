import { useTranslation } from 'react-i18next'
import { LAYOUT_MODES, useLayout, type LayoutMode } from '../state/layout'

function LayoutIcon({ mode }: { mode: LayoutMode }) {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1" y="1" width="14" height="12" rx="1.5" />
      {mode >= 2 && <path d="M8 1v12" />}
      {mode === 4 && <path d="M1 7h14" />}
    </svg>
  )
}

/** 1 chart / 2 side by side / 4 charts. */
export function LayoutSwitcher() {
  const { t } = useTranslation()
  const mode = useLayout((s) => s.mode)
  const setMode = useLayout((s) => s.setMode)
  return (
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
  )
}
