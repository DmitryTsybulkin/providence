import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Popover } from './Popover'

const pad = (n: number) => String(n).padStart(2, '0')
const toInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

export function GoToDate({ onGo }: { onGo(time: number): void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(() => toInput(new Date()))
  const time = new Date(value).getTime()
  const valid = Number.isFinite(time) && time <= Date.now()

  const submit = () => {
    if (!valid) return
    onGo(time)
    setOpen(false)
  }

  return (
    <div className="anchor">
      <button className={open ? 'tool-btn active' : 'tool-btn'} title={t('chart.goToDate')} onClick={() => setOpen(!open)}>
        {t('chart.goToDate')}
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)}>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <input
              className="input"
              type="datetime-local"
              value={value}
              max={toInput(new Date())}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
            <button className="btn primary" type="submit" disabled={!valid}>
              {t('chart.go')}
            </button>
          </form>
        </Popover>
      )}
    </div>
  )
}
