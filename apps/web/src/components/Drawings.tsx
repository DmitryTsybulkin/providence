import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DrawingGroup, DrawingShape, DrawingTool } from '@providence/core'
import {
  DRAWING_TOOLS, drawingHasLineStyle, drawingHasText, drawingLineKind, fromShapeStyles, toShapeStyles,
  type DrawingOptions, type DrawingPatch, type DrawingStyle,
} from '../chart'
import { Icon, type IconName } from './Icon'
import { Popover } from './Popover'

const GROUPS: { id: DrawingGroup; icon: IconName }[] = [
  { id: 'lines', icon: 'lines' },
  { id: 'channels', icon: 'channels' },
  { id: 'fib', icon: 'fib' },
  { id: 'forecast', icon: 'forecast' },
  { id: 'annotate', icon: 'annotate' },
]

export function useToolName() {
  const { t } = useTranslation()
  return (tool: Pick<DrawingTool, 'id' | 'label'>) => t(`drawings.tool.${tool.id}`, { defaultValue: tool.label })
}

interface ToolbarProps {
  /** Tool currently being placed, if any */
  tool: string | null
  options: DrawingOptions
  canUndo: boolean
  hasDrawings: boolean
  onPick(toolId: string | null): void
  onOptions(patch: Partial<DrawingOptions>): void
  onUndo(): void
  onClear(): void
}

/** Vertical toolbar on the left of a chart: tool groups with fly-out menus, then global toggles. */
export function DrawingToolbar(p: ToolbarProps) {
  const { t } = useTranslation()
  const toolName = useToolName()
  const [open, setOpen] = useState<DrawingGroup | null>(null)
  const activeGroup = DRAWING_TOOLS.find((x) => x.id === p.tool)?.group

  return (
    <div className="draw-bar" role="toolbar" aria-label={t('drawings.title')}>
      <button className={p.tool === null ? 'draw-btn active' : 'draw-btn'} title={t('drawings.cursor')} onClick={() => p.onPick(null)}>
        <Icon name="cursor" />
      </button>
      {GROUPS.map((g) => (
        <div key={g.id} className="anchor">
          <button
            className={activeGroup === g.id || open === g.id ? 'draw-btn active' : 'draw-btn'}
            title={t(`drawings.group.${g.id}`)}
            aria-haspopup="menu"
            aria-expanded={open === g.id}
            onClick={() => setOpen(open === g.id ? null : g.id)}
          >
            <Icon name={g.icon} />
          </button>
          {open === g.id && (
            <Popover onClose={() => setOpen(null)} className="menu flyout">
              <div className="menu-title">{t(`drawings.group.${g.id}`)}</div>
              {DRAWING_TOOLS.filter((x) => x.group === g.id).map((tool) => (
                <button
                  key={tool.id}
                  className={p.tool === tool.id ? 'menu-item checked' : 'menu-item'}
                  role="menuitem"
                  onClick={() => {
                    setOpen(null)
                    p.onPick(tool.id)
                  }}
                >
                  {toolName(tool)}
                </button>
              ))}
            </Popover>
          )}
        </div>
      ))}
      <span className="draw-sep" />
      <button className={p.options.magnet ? 'draw-btn on' : 'draw-btn'} title={t('drawings.magnet')} aria-pressed={p.options.magnet} onClick={() => p.onOptions({ magnet: !p.options.magnet })}>
        <Icon name="magnet" />
      </button>
      <button className={p.options.lockAll ? 'draw-btn on' : 'draw-btn'} title={t('drawings.lockAll')} aria-pressed={p.options.lockAll} onClick={() => p.onOptions({ lockAll: !p.options.lockAll })}>
        <Icon name="lock" />
      </button>
      <button className={p.options.hideAll ? 'draw-btn on' : 'draw-btn'} title={t('drawings.hideAll')} aria-pressed={p.options.hideAll} onClick={() => p.onOptions({ hideAll: !p.options.hideAll })}>
        <Icon name={p.options.hideAll ? 'eyeOff' : 'eye'} />
      </button>
      <button className="draw-btn" title={t('drawings.undo')} disabled={!p.canUndo} onClick={p.onUndo}>
        <Icon name="undo" />
      </button>
      <button className="draw-btn" title={t('drawings.clear')} disabled={!p.hasDrawings} onClick={p.onClear}>
        <Icon name="trash" />
      </button>
    </div>
  )
}

export const DRAWING_COLORS = ['#4c8dff', '#2ebd85', '#f6465d', '#e8a33d', '#c264d6', '#d6dbe2']
const WIDTHS = [1, 2, 3, 4]

interface StyleBarProps {
  shape: DrawingShape
  onPatch(patch: DrawingPatch): void
  onDelete(): void
  /** Offered for horizontal lines and trend lines (alerts.md §2) */
  onAlert?(): void
}

/** Small bar shown while a drawing is selected: colour, width, line style, text, lock, alert, delete. */
export function DrawingStyleBar({ shape, onPatch, onDelete, onAlert }: StyleBarProps) {
  const { t } = useTranslation()
  const toolName = useToolName()
  const style = fromShapeStyles(shape.styles)
  const tool = DRAWING_TOOLS.find((x) => x.id === shape.name)
  const setStyle = (patch: Partial<DrawingStyle>) => onPatch({ styles: toShapeStyles({ ...style, ...patch }) })

  return (
    <div className="style-bar" role="toolbar" aria-label={t('drawings.style')}>
      <span className="style-name">{tool ? toolName(tool) : shape.name}</span>
      {drawingHasLineStyle(shape.name) && (
        <>
          <div className="swatches" role="group" aria-label={t('drawings.color')}>
            {DRAWING_COLORS.map((c) => (
              <button
                key={c}
                className={c === style.color ? 'swatch active' : 'swatch'}
                style={{ background: c }}
                title={c}
                aria-label={c}
                aria-pressed={c === style.color}
                onClick={() => setStyle({ color: c })}
              />
            ))}
          </div>
          <select className="input mini" title={t('drawings.width')} aria-label={t('drawings.width')} value={style.width} onChange={(e) => setStyle({ width: Number(e.target.value) })}>
            {WIDTHS.map((w) => (
              <option key={w} value={w}>
                {w}px
              </option>
            ))}
          </select>
          <select className="input mini" title={t('drawings.lineStyle')} aria-label={t('drawings.lineStyle')} value={style.dashed ? 'dashed' : 'solid'} onChange={(e) => setStyle({ dashed: e.target.value === 'dashed' })}>
            <option value="solid">{t('drawings.solid')}</option>
            <option value="dashed">{t('drawings.dashed')}</option>
          </select>
        </>
      )}
      {drawingHasText(shape.name) && (
        <input
          className="input text"
          placeholder={t('drawings.text')}
          aria-label={t('drawings.text')}
          value={typeof shape.extendData === 'string' ? shape.extendData : ''}
          onChange={(e) => onPatch({ extendData: e.target.value })}
        />
      )}
      <button className={shape.lock ? 'draw-btn on' : 'draw-btn'} title={t('drawings.lock')} aria-pressed={!!shape.lock} onClick={() => onPatch({ lock: !shape.lock })}>
        <Icon name="lock" />
      </button>
      {onAlert && drawingLineKind(shape) && (
        <button className="draw-btn" title={t('drawings.alert')} onClick={onAlert}>
          <Icon name="bell" />
        </button>
      )}
      <button className="draw-btn" title={t('drawings.delete')} onClick={onDelete}>
        <Icon name="trash" />
      </button>
    </div>
  )
}
