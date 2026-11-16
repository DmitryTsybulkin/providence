/** Number formatting helpers (locale-independent, so EN and RU show the same digits). */

export function formatPrice(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(Math.max(0, Math.min(12, precision)))
}

/** 1234567 → "1.23M" */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e12) return (value / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return (value / 1e3).toFixed(2) + 'K'
  return value.toFixed(abs >= 100 ? 0 : 2)
}

/** Fraction → signed percent: 0.0123 → "+1.23%" */
export function formatPct(fraction: number, digits = 2): string {
  if (!Number.isFinite(fraction)) return '—'
  const pct = fraction * 100
  return `${pct > 0 ? '+' : ''}${pct.toFixed(digits)}%`
}

export function signClass(value: number): string {
  return value > 0 ? 'up' : value < 0 ? 'down' : ''
}

const pad = (n: number) => String(n).padStart(2, '0')

/** yyyy-MM-dd HH:mm in local time */
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** yyyyMMdd-HHmm in local time (export file names) */
export function formatFileStamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}
