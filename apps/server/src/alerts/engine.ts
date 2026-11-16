/**
 * Alert engine (alerts.md): evaluates alerts on live Bybit data inside the server, so they fire with the tab closed.
 * - price / line alerts: checked on every ticker update
 * - indicator alerts: checked once per CLOSED candle (no repaint)
 * - no duplicates: the candle (or minute bucket) an alert last fired in is stored with the alert
 */
import { randomUUID } from 'node:crypto'
import {
  computeAlertIndicator, conditionMet, lineValueAt, minuteBucket, symbolKey,
  type Alert, type AlertChannel, type AlertInput, type AlertLine, type Candle, type Category, type FiredAlert,
  type IndicatorAlert, type Timeframe, type Unsubscribe,
} from '@providence/core'
import type { MarketFeed } from './feed'
import type { AlertStore } from './store'

export type CandleLoader = (q: { category: Category; symbol: string; tf: Timeframe; end: number; limit: number }) => Promise<Candle[]>

export interface AlertEngineDeps {
  store: AlertStore
  feed: MarketFeed
  loadCandles: CandleLoader
  channels: AlertChannel[]
  now?: () => number
  /** Called whenever the alert list changed (fired, expired, edited) */
  onChange?: () => void
  log?: (message: string) => void
}

interface Observation {
  value: number
  threshold: number
}

/** Enough history for the recursive indicators (EMA/RSI/ATR) to converge. */
export function indicatorHistory(length: number): number {
  return Math.min(1000, Math.max(300, length * 10))
}

const fmt = (n: number) => (Math.abs(n) >= 1 ? n.toFixed(Math.abs(n) >= 100 ? 2 : 4) : n.toPrecision(4))
const VERB: Record<Alert['condition'], string> = { cross: 'crossed', above: 'rose above', below: 'fell below' }

export function alertMessage(alert: Alert, value: number, threshold: number): string {
  const head = alert.type === 'indicator'
    ? `${alert.symbol} ${alert.indicator.id.toUpperCase()}(${alert.indicator.length}) ${alert.indicator.tf} ${VERB[alert.condition]} ${fmt(threshold)} (${fmt(value)})`
    : `${alert.symbol} price ${VERB[alert.condition]} ${alert.type === 'line' ? 'the line at ' : ''}${fmt(threshold)} (${fmt(value)})`
  return alert.note ? `${head} — ${alert.note}` : head
}

export class AlertEngine {
  private readonly now: () => number
  private alerts = new Map<string, Alert>()
  /** Previous observation per alert, for cross / edge detection. Kept across WS reconnects. */
  private readonly previous = new Map<string, Observation>()
  private readonly lastPrice = new Map<string, number>()
  private readonly subs = new Map<string, Unsubscribe>()
  private expiryTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: AlertEngineDeps) {
    this.now = deps.now ?? Date.now
  }

  start(): void {
    this.alerts = new Map(this.deps.store.list().map((a) => [a.id, a]))
    this.expire()
    this.syncSubscriptions()
    this.expiryTimer = setInterval(() => this.expire(), 30_000)
  }

  stop(): void {
    if (this.expiryTimer) clearInterval(this.expiryTimer)
    this.expiryTimer = null
    for (const off of this.subs.values()) off()
    this.subs.clear()
    this.deps.feed.close()
  }

  // ---------- CRUD ----------

  list(): Alert[] {
    return [...this.alerts.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  create(input: AlertInput): Alert {
    const alert = { ...input, id: randomUUID(), status: 'active', createdAt: this.now() } as Alert
    this.put(alert)
    return alert
  }

  /** Pause or (re)activate. Activating re-arms the alert: previous observation and dedup marker are cleared. */
  setStatus(id: string, status: 'active' | 'paused'): Alert | undefined {
    const alert = this.alerts.get(id)
    if (!alert) return undefined
    const next = { ...alert, status } as Alert
    if (status === 'active') {
      delete next.lastFiredCandle
      this.previous.delete(id)
    }
    this.put(next)
    return next
  }

  remove(id: string): boolean {
    if (!this.alerts.delete(id)) return false
    this.previous.delete(id)
    this.deps.store.delete(id)
    this.syncSubscriptions()
    this.deps.onChange?.()
    return true
  }

  /**
   * Drawings of a symbol changed: move line alerts with their line; pause alerts whose line was deleted.
   * Returns the number of alerts touched.
   */
  syncLines(category: Category, symbol: string, lines: AlertLine[]): number {
    const byId = new Map(lines.map((l) => [l.drawingId, l]))
    let touched = 0
    for (const alert of this.alerts.values()) {
      if (alert.type !== 'line' || alert.category !== category || alert.symbol !== symbol) continue
      const line = byId.get(alert.line.drawingId)
      if (!line) {
        if (alert.status === 'active') {
          this.save({ ...alert, status: 'paused' })
          touched++
        }
      } else if (JSON.stringify(line) !== JSON.stringify(alert.line)) {
        this.previous.delete(alert.id) // the threshold jumped; do not read that as a cross
        this.save({ ...alert, line })
        touched++
      }
    }
    if (touched) {
      this.syncSubscriptions()
      this.deps.onChange?.()
    }
    return touched
  }

  private put(alert: Alert): void {
    this.save(alert)
    this.syncSubscriptions()
    this.deps.onChange?.()
  }

  private save(alert: Alert): void {
    this.alerts.set(alert.id, alert)
    this.deps.store.save(alert)
  }

  // ---------- subscriptions ----------

  private syncSubscriptions(): void {
    const wanted = new Map<string, () => Unsubscribe>()
    for (const a of this.alerts.values()) {
      if (a.status !== 'active') continue
      if (a.type === 'indicator') {
        const { tf } = a.indicator
        wanted.set(`kline|${a.category}|${a.symbol}|${tf}`, () =>
          this.deps.feed.subscribeClosedCandle(a.category, a.symbol, tf, (c) => void this.onClosedCandle(a.category, a.symbol, tf, c)),
        )
      } else {
        wanted.set(`price|${a.category}|${a.symbol}`, () =>
          this.deps.feed.subscribePrice(a.category, a.symbol, (price, time) => this.onPrice(a.category, a.symbol, price, time)),
        )
      }
    }
    for (const [key, off] of this.subs) {
      if (!wanted.has(key)) {
        off()
        this.subs.delete(key)
      }
    }
    for (const [key, subscribe] of wanted) {
      if (!this.subs.has(key)) this.subs.set(key, subscribe())
    }
  }

  // ---------- evaluation ----------

  /** Public for tests: one price update. */
  onPrice(category: Category, symbol: string, price: number, time: number): void {
    this.lastPrice.set(symbolKey(category, symbol), price)
    for (const alert of [...this.alerts.values()]) {
      if (alert.status !== 'active' || alert.type === 'indicator') continue
      if (alert.category !== category || alert.symbol !== symbol) continue
      if (this.isExpired(alert)) continue
      const threshold = alert.type === 'price' ? alert.value : lineValueAt(alert.line, time)
      if (threshold === null) {
        this.previous.delete(alert.id) // outside the line's time range
        continue
      }
      const prev = this.previous.get(alert.id)
      this.previous.set(alert.id, { value: price, threshold })
      // First observation of an alert that already fired (e.g. after a server restart): just re-arm.
      if (!prev && alert.lastFiredCandle !== undefined) continue
      if (!conditionMet(alert.condition, prev?.value ?? null, price, threshold, prev?.threshold ?? threshold)) continue
      const bucket = minuteBucket(time)
      if (alert.lastFiredCandle === bucket) continue
      this.fire(alert, bucket, price, price, threshold)
    }
  }

  /** Public for tests: a candle just closed. */
  async onClosedCandle(category: Category, symbol: string, tf: Timeframe, candle: Candle): Promise<void> {
    const due = [...this.alerts.values()].filter(
      (a): a is IndicatorAlert =>
        a.status === 'active' && a.type === 'indicator' && a.category === category && a.symbol === symbol &&
        a.indicator.tf === tf && !this.isExpired(a) && (a.lastFiredCandle === undefined || a.lastFiredCandle < candle.t),
    )
    if (due.length === 0) return
    const limit = Math.max(...due.map((a) => indicatorHistory(a.indicator.length)))
    let candles: Candle[]
    try {
      candles = (await this.deps.loadCandles({ category, symbol, tf, end: candle.t, limit })).filter((c) => c.t < candle.t)
    } catch (err) {
      this.deps.log?.(`alert candles for ${symbol} ${tf} failed: ${String(err)}`)
      return
    }
    candles.push(candle) // the closed candle exactly as the exchange reported it
    for (const stale of due) {
      const alert = this.alerts.get(stale.id)
      // Re-check: the alert may have changed or fired while the candles were loading.
      if (!alert || alert.type !== 'indicator' || alert.status !== 'active') continue
      if (alert.lastFiredCandle !== undefined && alert.lastFiredCandle >= candle.t) continue
      const series = computeAlertIndicator(alert.indicator.id, alert.indicator.length, candles)
      const cur = series[series.length - 1]
      const prev = series[series.length - 2] ?? null
      if (cur === null) continue
      // alerts.md: "RSI 14 > 70 on candle close, once per candle" — above/below are checked as a level at every
      // close (the per-candle marker prevents repeats); only `cross` needs the previous value.
      if (!conditionMet(alert.condition, alert.condition === 'cross' ? prev : null, cur, alert.value)) continue
      this.fire(alert, candle.t, candle.c, cur, alert.value)
    }
  }

  private fire(alert: Alert, marker: number, price: number, value: number, threshold: number): void {
    const fired: FiredAlert = {
      id: randomUUID(),
      alertId: alert.id,
      category: alert.category,
      symbol: alert.symbol,
      firedAt: this.now(),
      price,
      value,
      threshold,
      message: alertMessage(alert, value, threshold),
    }
    const next = { ...alert, lastFiredCandle: marker, status: alert.trigger === 'once' ? 'triggered' : alert.status } as Alert
    this.save(next)
    this.deps.store.addHistory(fired)
    for (const channel of this.deps.channels) {
      channel.send(fired).catch((err) => this.deps.log?.(`alert channel ${channel.id} failed: ${String(err)}`))
    }
    if (next.status !== 'active') this.syncSubscriptions()
    this.deps.onChange?.()
  }

  private isExpired(alert: Alert): boolean {
    return alert.expiresAt !== undefined && alert.expiresAt <= this.now()
  }

  private expire(): void {
    let changed = false
    for (const alert of [...this.alerts.values()]) {
      if (alert.status === 'active' && this.isExpired(alert)) {
        this.save({ ...alert, status: 'expired' })
        changed = true
      }
    }
    if (changed) {
      this.syncSubscriptions()
      this.deps.onChange?.()
    }
  }
}
