import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ALERT_INDICATORS, TIMEFRAMES,
  type Alert, type AlertCondition, type AlertInput, type AlertTrigger, type Timeframe,
} from '@providence/core'
import { Modal } from '../components/Modal'
import { formatDateTime } from '../lib/format'
import { useAlerts } from '../state/alerts'
import { useLayout } from '../state/layout'
import { useMarket } from '../state/market'

const CONDITIONS: AlertCondition[] = ['cross', 'above', 'below']
const num = (n: number) => (Math.abs(n) >= 1 ? String(+n.toFixed(4)) : String(+n.toPrecision(5)))

function useDescribe() {
  const { t } = useTranslation()
  return (a: Alert): string => {
    const cond = t(`alerts.condition.${a.condition}`)
    if (a.type === 'price') return `${t('alerts.type.price')} ${cond} ${num(a.value)}`
    if (a.type === 'line') return `${t('alerts.type.price')} ${cond} ${t(`alerts.line.${a.line.kind}`)}`
    return `${a.indicator.id.toUpperCase()}(${a.indicator.length}) ${a.indicator.tf} ${cond} ${num(a.value)}`
  }
}

/** Right-hand panel: alert list (create, pause, delete) and firing history. */
export function AlertsPanel() {
  const { t } = useTranslation()
  const describe = useDescribe()
  const alerts = useAlerts((s) => s.alerts)
  const history = useAlerts((s) => s.history)
  const connected = useAlerts((s) => s.connected)
  const [tab, setTab] = useState<'alerts' | 'history'>('alerts')
  const { setStatus, remove, clearHistory, openDraft } = useAlerts.getState()

  const newAlert = () => {
    const l = useLayout.getState()
    const cell = l.cells[l.active]
    const last = useMarket.getState().tickers[`${cell.category}:${cell.symbol}`]?.lastPrice
    openDraft({ type: 'price', category: cell.category, symbol: cell.symbol, condition: 'cross', trigger: 'once', ...(last ? { value: last } : {}) } as Partial<AlertInput>)
  }

  return (
    <section className="panel alerts-panel" aria-label={t('alerts.title')}>
      <div className="panel-head">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'alerts'} className={tab === 'alerts' ? 'tab active' : 'tab'} onClick={() => setTab('alerts')}>
            {t('alerts.title')} <span className="count">{alerts.length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'tab active' : 'tab'} onClick={() => setTab('history')}>
            {t('alerts.history')}
          </button>
        </div>
        {tab === 'alerts' ? (
          <button className="btn primary" onClick={newAlert}>
            + {t('alerts.new')}
          </button>
        ) : (
          <button className="btn" disabled={history.length === 0} onClick={() => void clearHistory()}>
            {t('alerts.clear')}
          </button>
        )}
      </div>
      {!connected && <div className="panel-note warn">{t('alerts.paused')}</div>}
      <div className="alerts-scroll">
        {tab === 'alerts' ? (
          alerts.length === 0 ? (
            <div className="empty muted">{t('alerts.none')}</div>
          ) : (
            alerts.map((a) => (
              <div key={a.id} className={`alert-row ${a.status}`}>
                <div className="alert-main">
                  <div className="alert-line">
                    <span className="sym">{a.symbol}</span>
                    <span className="tag">{t(`category.${a.category}`)}</span>
                    <span className={`status ${a.status}`}>{t(`alerts.status.${a.status}`)}</span>
                  </div>
                  <div className="small">{describe(a)}</div>
                  <div className="muted small">
                    {t(`alerts.trigger.${a.trigger}`)}
                    {a.expiresAt ? ` · ${t('alerts.until')} ${formatDateTime(a.expiresAt)}` : ''}
                    {a.note ? ` · ${a.note}` : ''}
                  </div>
                </div>
                <div className="alert-actions">
                  {a.status === 'active' ? (
                    <button className="tool-btn" onClick={() => void setStatus(a.id, 'paused')}>
                      {t('alerts.pause')}
                    </button>
                  ) : (
                    <button className="tool-btn" onClick={() => void setStatus(a.id, 'active')}>
                      {t('alerts.resume')}
                    </button>
                  )}
                  <button className="tool-btn" onClick={() => void remove(a.id)}>
                    {t('alerts.delete')}
                  </button>
                </div>
              </div>
            ))
          )
        ) : history.length === 0 ? (
          <div className="empty muted">{t('alerts.noHistory')}</div>
        ) : (
          history.map((h) => (
            <div key={h.id} className="alert-row">
              <div className="alert-main">
                <div className="small">{h.message}</div>
                <div className="muted small">{formatDateTime(h.firedAt)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

/** Dialog for a new alert. Line alerts arrive here pre-filled from a selected drawing. */
export function AlertDialog() {
  const { t } = useTranslation()
  const draft = useAlerts((s) => s.draft)
  if (!draft) return null
  return <AlertForm key={JSON.stringify(draft)} draft={draft} title={t('alerts.new')} />
}

function AlertForm({ draft, title }: { draft: Partial<AlertInput>; title: string }) {
  const { t } = useTranslation()
  const { closeDraft, create } = useAlerts.getState()
  const isLine = draft.type === 'line'
  const [type, setType] = useState<'price' | 'indicator' | 'line'>(draft.type ?? 'price')
  const [condition, setCondition] = useState<AlertCondition>(draft.condition ?? 'cross')
  const [trigger, setTrigger] = useState<AlertTrigger>(draft.trigger ?? 'once')
  const [value, setValue] = useState(() => ('value' in draft && draft.value !== undefined ? String(draft.value) : ''))
  const [indicator, setIndicator] = useState<string>('rsi')
  const [length, setLength] = useState('14')
  const [tf, setTf] = useState<Timeframe>('1h')
  const [expires, setExpires] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const base = {
      category: draft.category ?? 'linear',
      symbol: draft.symbol ?? '',
      condition,
      trigger,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(expires ? { expiresAt: new Date(expires).getTime() } : {}),
    }
    let input: AlertInput
    if (type === 'line' && draft.type === 'line' && draft.line) input = { ...base, type: 'line', line: draft.line }
    else if (type === 'indicator') input = { ...base, type: 'indicator', value: Number(value), indicator: { id: indicator, length: Number(length), tf } }
    else input = { ...base, type: 'price', value: Number(value) }
    setBusy(true)
    setError(null)
    try {
      await create(input)
      closeDraft()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`${title} — ${draft.symbol ?? ''}`}
      onClose={closeDraft}
      width={380}
      footer={
        <>
          {error && <span className="down small grow">{error}</span>}
          {!error && <span className="grow" />}
          <button className="btn" onClick={closeDraft}>
            {t('chart.cancel')}
          </button>
          <button className="btn primary" disabled={busy || (type !== 'line' && value.trim() === '')} onClick={() => void submit()}>
            {t('alerts.create')}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="field">
          <span>{t('alerts.field.type')}</span>
          {isLine ? (
            <span>{t(`alerts.line.${draft.type === 'line' && draft.line ? draft.line.kind : 'horizontal'}`)}</span>
          ) : (
            <select className="input" value={type} onChange={(e) => setType(e.target.value as 'price' | 'indicator')}>
              <option value="price">{t('alerts.type.price')}</option>
              <option value="indicator">{t('alerts.type.indicator')}</option>
            </select>
          )}
        </label>
        {type === 'indicator' && (
          <>
            <label className="field">
              <span>{t('alerts.field.indicator')}</span>
              <select className="input" value={indicator} onChange={(e) => setIndicator(e.target.value)}>
                {ALERT_INDICATORS.map((id) => (
                  <option key={id} value={id}>
                    {id.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('indicators.param.length')}</span>
              <input className="input" type="number" min={1} max={500} step={1} value={length} onChange={(e) => setLength(e.target.value)} />
            </label>
            <label className="field">
              <span>{t('chart.timeframe')}</span>
              <select className="input" value={tf} onChange={(e) => setTf(e.target.value as Timeframe)}>
                {TIMEFRAMES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="field">
          <span>{t('alerts.field.condition')}</span>
          <select className="input" value={condition} onChange={(e) => setCondition(e.target.value as AlertCondition)}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {t(`alerts.condition.${c}`)}
              </option>
            ))}
          </select>
        </label>
        {type !== 'line' && (
          <label className="field">
            <span>{t('alerts.field.value')}</span>
            <input className="input" type="number" step="any" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>{t('alerts.field.trigger')}</span>
          <select className="input" value={trigger} onChange={(e) => setTrigger(e.target.value as AlertTrigger)}>
            <option value="once">{t('alerts.trigger.once')}</option>
            <option value="every">{t('alerts.trigger.every')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('alerts.field.expires')}</span>
          <input className="input" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('alerts.field.note')}</span>
          <input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {type === 'indicator' && <div className="muted small">{t('alerts.onClose')}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

/** Fired alerts, bottom right. */
export function Toasts() {
  const toasts = useAlerts((s) => s.toasts)
  const dismiss = useAlerts((s) => s.dismissToast)
  if (toasts.length === 0) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className="toast">
          <div className="toast-body">
            <div className="toast-title">{x.fired.symbol}</div>
            <div className="small">{x.fired.message}</div>
          </div>
          <button className="tool-btn" onClick={() => dismiss(x.id)} aria-label="×">
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
