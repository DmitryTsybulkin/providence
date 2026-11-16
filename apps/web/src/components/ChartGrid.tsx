import { useLayout } from '../state/layout'
import { ChartCell } from './ChartCell'

/** 1, 2 (side by side) or 4 (2×2) charts. Each cell has its own symbol, timeframe and indicators. */
export function ChartGrid() {
  const mode = useLayout((s) => s.mode)
  const active = useLayout((s) => s.active)
  const setActive = useLayout((s) => s.setActive)
  return (
    <section className={`charts grid-${mode}`}>
      {Array.from({ length: mode }, (_, i) => (
        <div
          key={i}
          className={mode > 1 && i === active ? 'cell-frame active' : 'cell-frame'}
          // Capture phase: the cell becomes active before the click reaches the chart or its buttons.
          onMouseDownCapture={() => setActive(i)}
        >
          <ChartCell index={i} />
        </div>
      ))}
    </section>
  )
}
