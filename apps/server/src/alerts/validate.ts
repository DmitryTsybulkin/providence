import {
  ALERT_INDICATORS, CATEGORIES, TIMEFRAMES,
  type AlertCondition, type AlertInput, type AlertLine, type AlertTrigger, type Category, type DrawingPoint,
  type LineKind, type Timeframe,
} from '@providence/core'

const CONDITIONS: AlertCondition[] = ['cross', 'above', 'below']
const TRIGGERS: AlertTrigger[] = ['once', 'every']
const LINE_KINDS: LineKind[] = ['horizontal', 'segment', 'ray', 'straight']
const SYMBOL_RE = /^[A-Za-z0-9_.-]{1,40}$/

export class ValidationError extends Error {
  readonly statusCode = 400
}
const fail = (message: string): never => {
  throw new ValidationError(message)
}
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], name: string): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fail(`${name} must be one of ${allowed.join(', ')}`)
const finite = (v: unknown, name: string): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fail(`${name} must be a number`)

export function parseLine(v: unknown): AlertLine {
  const o = (v ?? {}) as Record<string, unknown>
  const kind = oneOf(o.kind, LINE_KINDS, 'line.kind')
  if (typeof o.drawingId !== 'string' || !o.drawingId) fail('line.drawingId is required')
  if (!Array.isArray(o.points)) fail('line.points must be an array')
  const points: DrawingPoint[] = (o.points as unknown[]).map((p, i) => {
    const q = (p ?? {}) as Record<string, unknown>
    return { timestamp: finite(q.timestamp, `line.points[${i}].timestamp`), value: finite(q.value, `line.points[${i}].value`) }
  })
  if (points.length < (kind === 'horizontal' ? 1 : 2)) fail('line has too few points')
  return { drawingId: o.drawingId as string, kind, points: points.slice(0, 2) }
}

/** Validate the body of POST /api/alerts. Throws ValidationError (HTTP 400). */
export function parseAlertInput(body: unknown, now: number): AlertInput {
  const o = (body ?? {}) as Record<string, unknown>
  const category: Category = oneOf(o.category, CATEGORIES, 'category')
  if (typeof o.symbol !== 'string' || !SYMBOL_RE.test(o.symbol)) fail('invalid symbol')
  const base = {
    category,
    symbol: (o.symbol as string).toUpperCase(),
    condition: oneOf(o.condition, CONDITIONS, 'condition'),
    trigger: oneOf(o.trigger ?? 'once', TRIGGERS, 'trigger'),
    ...(typeof o.note === 'string' && o.note.trim() ? { note: o.note.trim().slice(0, 200) } : {}),
    ...(o.expiresAt !== undefined && o.expiresAt !== null
      ? { expiresAt: finite(o.expiresAt, 'expiresAt') > now ? (o.expiresAt as number) : fail('expiresAt must be in the future') }
      : {}),
  }
  switch (o.type) {
    case 'price': {
      const value = finite(o.value, 'value')
      if (value <= 0) fail('value must be positive')
      return { ...base, type: 'price', value }
    }
    case 'line':
      return { ...base, type: 'line', line: parseLine(o.line) }
    case 'indicator': {
      const ind = (o.indicator ?? {}) as Record<string, unknown>
      const length = finite(ind.length, 'indicator.length')
      if (!Number.isInteger(length) || length < 1 || length > 500) fail('indicator.length must be an integer in [1, 500]')
      const tf: Timeframe = oneOf(ind.tf, TIMEFRAMES, 'indicator.tf')
      return {
        ...base,
        type: 'indicator',
        indicator: { id: oneOf(ind.id, ALERT_INDICATORS, 'indicator.id'), length, tf },
        value: finite(o.value, 'value'),
      }
    }
    default:
      return fail('type must be one of price, line, indicator')
  }
}
