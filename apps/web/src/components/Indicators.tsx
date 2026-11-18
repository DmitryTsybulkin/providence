import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveParams, type IndicatorDef, type IndicatorState, type ParamValues } from '@providence/core'
import { getIndicatorDef, indicatorCaption, listIndicatorDefs } from '../chart'
import { MAX_INDICATORS, useLayout } from '../state/layout'
import { Modal } from './Modal'
import { Popover } from './Popover'

function useIndicatorNames() {
  const { t } = useTranslation()
  return {
    name: (def: IndicatorDef) => t(`indicators.name.${def.id}`, { defaultValue: def.label }),
    param: (key: string, label: string) => t(`indicators.param.${key}`, { defaultValue: label }),
  }
}

/** Header button + picker: add indicators, grouped by where they are drawn. */
export function IndicatorPicker({ index }: { index: number }) {
  const { t } = useTranslation()
  const names = useIndicatorNames()
  const indicators = useLayout((s) => s.cells[index].indicators)
  const [open, setOpen] = useState(false)
  const defs = listIndicatorDefs()
  const full = indicators.length >= MAX_INDICATORS

  const toggle = (def: IndicatorDef) => {
    const { setIndicators } = useLayout.getState()
    if (indicators.some((i) => i.id === def.id)) setIndicators(index, indicators.filter((i) => i.id !== def.id))
    else if (!full) setIndicators(index, [...indicators, { id: def.id, params: {}, visible: true }])
  }

  const group = (pane: IndicatorDef['pane']) => (
    <div className="menu-group">
      <div className="menu-title">{t(`indicators.pane.${pane}`)}</div>
      {defs
        .filter((d) => d.pane === pane)
        .map((def) => {
          const added = indicators.some((i) => i.id === def.id)
          return (
            <button
              key={def.id}
              className={added ? 'menu-item checked' : 'menu-item'}
              disabled={!added && full}
              role="menuitemcheckbox"
              aria-checked={added}
              onClick={() => toggle(def)}
            >
              <span className="check">{added ? '✓' : ''}</span>
              {names.name(def)}
            </button>
          )
        })}
    </div>
  )

  return (
    <div className="anchor">
      <button className={open ? 'tool-btn active' : 'tool-btn'} onClick={() => setOpen(!open)}>
        {t('indicators.title')}
        {indicators.length > 0 && <span className="count">{indicators.length}</span>}
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="menu">
          {group('overlay')}
          {group('separate')}
          <div className={full ? 'menu-note warn' : 'menu-note'}>
            {full ? t('indicators.maxReached', { max: MAX_INDICATORS }) : t('indicators.count', { count: indicators.length, max: MAX_INDICATORS })}
          </div>
        </Popover>
      )}
    </div>
  )
}

/** Row of chips under the chart header: one per indicator with hide / settings / remove. */
export function IndicatorChips({ index }: { index: number }) {
  const { t } = useTranslation()
  const names = useIndicatorNames()
  const indicators = useLayout((s) => s.cells[index].indicators)
  const [editing, setEditing] = useState<string | null>(null)
  if (indicators.length === 0) return null

  const update = (next: IndicatorState[]) => useLayout.getState().setIndicators(index, next)
  const editingState = indicators.find((i) => i.id === editing)
  const editingDef = editing ? getIndicatorDef(editing) : undefined

  return (
    <div className="chips">
      {indicators.map((state) => {
        const def = getIndicatorDef(state.id)
        if (!def) return null
        const hasParams = Object.keys(def.params).length > 0
        const caption = indicatorCaption({ ...def, label: names.name(def) }, state.params)
        return (
          <span key={state.id} className={state.visible ? 'chip' : 'chip off'}>
            <span className="chip-label">{caption}</span>
            <button
              className="chip-btn"
              title={state.visible ? t('indicators.hide') : t('indicators.show')}
              aria-pressed={!state.visible}
              onClick={() => update(indicators.map((i) => (i.id === state.id ? { ...i, visible: !i.visible } : i)))}
            >
              {state.visible ? '◉' : '○'}
            </button>
            {hasParams && (
              <button className="chip-btn" title={t('indicators.settings')} onClick={() => setEditing(state.id)}>
                ⚙
              </button>
            )}
            <button className="chip-btn" title={t('indicators.remove')} onClick={() => update(indicators.filter((i) => i.id !== state.id))}>
              ✕
            </button>
          </span>
        )
      })}
      {editingState && editingDef && (
        <ParamsDialog
          def={editingDef}
          values={editingState.params}
          onClose={() => setEditing(null)}
          onApply={(params) => {
            update(indicators.map((i) => (i.id === editingState.id ? { ...i, params } : i)))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function ParamsDialog(props: { def: IndicatorDef; values: ParamValues; onApply(p: ParamValues): void; onClose(): void }) {
  const { t } = useTranslation()
  const names = useIndicatorNames()
  const { def } = props
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(resolveParams(def.params, props.values)).map(([k, v]) => [k, String(v)])),
  )
  const defaults = () => setDraft(Object.fromEntries(Object.entries(def.params).map(([k, p]) => [k, String(p.default)])))
  const apply = () => props.onApply(resolveParams(def.params, draft))

  return (
    <Modal
      title={`${names.name(def)} — ${t('indicators.settings')}`}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={defaults}>
            {t('indicators.defaults')}
          </button>
          <span className="grow" />
          <button className="btn" onClick={props.onClose}>
            {t('chart.cancel')}
          </button>
          <button className="btn primary" onClick={apply}>
            {t('indicators.apply')}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        {Object.entries(def.params).map(([key, p], i) => (
          <label key={key} className="field">
            <span>{names.param(key, p.label)}</span>
            {p.type === 'select' ? (
              <select className="input" value={draft[key] ?? p.default} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}>
                {p.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(`indicators.option.${o.value}`, { defaultValue: o.label })}
                  </option>
                ))}
              </select>
            ) : (
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min={p.min}
              max={p.max}
              step={p.step ?? 'any'}
              value={draft[key] ?? ''}
              autoFocus={i === 0}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
            )}
          </label>
        ))}
        {Object.values(def.params).some((p) => p.type === 'number' && p.min === 0) && <div className="muted small">{t('indicators.zeroHint')}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
