import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Category, Timeframe } from '@providence/core'
import type { ChartEngine } from '../chart'
import { candlesToCsv, exportFileName, parseLegacyJson, toLegacyJson, type ImportedChart } from '../lib/export'
import { Popover } from './Popover'

function download(name: string, href: string, revoke = false) {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 1000)
}
const downloadText = (name: string, text: string, type: string) => download(name, URL.createObjectURL(new Blob([text], { type })), true)

interface Props {
  getEngine(): ChartEngine | null
  symbol: string
  category: Category
  tf: Timeframe
  onImport(chart: ImportedChart): void
}

/** Chart menu: CSV, JSON (legacy format), PNG screenshot, and JSON import for viewing (export.md). */
export function ExportMenu({ getEngine, symbol, category, tf, onImport }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = (kind: 'csv' | 'json' | 'png') => {
    const engine = getEngine()
    if (!engine) return
    const now = Date.now()
    if (kind === 'csv') downloadText(exportFileName(symbol, tf, 'csv', now), candlesToCsv(engine.getCandles()), 'text/csv')
    else if (kind === 'json') {
      const doc = toLegacyJson({ symbol, category, tf, candles: engine.getCandles(), indicators: engine.getIndicatorData(), now })
      downloadText(exportFileName(symbol, tf, 'json', now), JSON.stringify(doc), 'application/json')
    } else download(exportFileName(symbol, tf, 'png', now), engine.screenshot())
    setOpen(false)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      onImport(parseLegacyJson(await file.text()))
      setError(null)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="anchor">
      <button className={open ? 'tool-btn active' : 'tool-btn'} onClick={() => setOpen(!open)}>
        {t('export.title')}
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="menu right">
          <button className="menu-item" role="menuitem" onClick={() => run('csv')}>
            {t('export.csv')}
          </button>
          <button className="menu-item" role="menuitem" onClick={() => run('json')}>
            {t('export.json')}
          </button>
          <button className="menu-item" role="menuitem" onClick={() => run('png')}>
            {t('export.png')}
          </button>
          <div className="menu-group">
            <button className="menu-item" role="menuitem" onClick={() => fileRef.current?.click()}>
              {t('export.import')}
            </button>
            {error && <div className="menu-note warn">{t('export.importFailed', { error })}</div>}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void onFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </Popover>
      )}
    </div>
  )
}
