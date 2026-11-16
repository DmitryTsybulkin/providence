import websocket from '@fastify/websocket'
import Fastify, { type FastifyInstance } from 'fastify'
import { BybitRest } from '@providence/adapter-bybit'
import { CATEGORIES, TIMEFRAMES, type AlertChannel, type Category, type ServerEvent, type Timeframe } from '@providence/core'
import { InAppChannel, OsChannel } from './alerts/channels'
import { AlertEngine } from './alerts/engine'
import { BybitFeed, type MarketFeed } from './alerts/feed'
import { AlertStore } from './alerts/store'
import { parseAlertInput, parseLine } from './alerts/validate'
import { CandleService } from './candles'
import type { ServerConfig } from './config'
import { CandleStore, KvStore, openDb, type Db } from './db'
import { MarketService } from './market'

export interface AppDeps {
  config: ServerConfig
  db?: Db
  rest?: BybitRest
  logger?: boolean
  /** Live data for alerts; default = Bybit public WebSocket */
  feed?: MarketFeed
  /** Extra alert channels; default = OS notification. The in-app channel is always added. */
  channels?: AlertChannel[]
}

export interface App {
  fastify: FastifyInstance
  db: Db
  rest: BybitRest
  candles: CandleService
  market: MarketService
  kv: KvStore
  alerts: AlertEngine
  /** Push an event to every connected web client */
  broadcast(e: ServerEvent): void
}

const SYMBOL_RE = /^[A-Za-z0-9_.-]{1,40}$/
const KEY_RE = /^[A-Za-z0-9_.:-]{1,200}$/

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
  }
}
export const bad = (message: string) => new HttpError(400, message)
export const notFound = (message = 'not found') => new HttpError(404, message)

export function parseCategory(v: unknown): Category {
  if (typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v)) return v as Category
  throw bad(`category must be one of ${CATEGORIES.join(', ')}`)
}
export function parseTf(v: unknown): Timeframe {
  if (typeof v === 'string' && (TIMEFRAMES as readonly string[]).includes(v)) return v as Timeframe
  throw bad(`tf must be one of ${TIMEFRAMES.join(', ')}`)
}
export function parseSymbol(v: unknown): string {
  if (typeof v === 'string' && SYMBOL_RE.test(v)) return v.toUpperCase()
  throw bad('invalid symbol')
}
function parseInt_(v: unknown, name: string, min: number, max: number, fallback?: number): number {
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback
    throw bad(`${name} is required`)
  }
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be an integer in [${min}, ${max}]`)
  return n
}

export function buildApp(deps: AppDeps): App {
  const { config } = deps
  const db = deps.db ?? openDb(config.dbPath)
  const rest = deps.rest ?? new BybitRest({ restHost: config.bybit.restHost })
  const meta = new KvStore(db, 'cache_meta')
  const kv = new KvStore(db, 'kv')
  const candles = new CandleService(rest, new CandleStore(db), meta)
  const market = new MarketService(rest, meta)

  const fastify = Fastify({ logger: deps.logger ?? false, bodyLimit: 8 * 1024 * 1024 })

  fastify.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 502
    if (status === 502) fastify.log.warn({ err: err.message }, 'upstream failure')
    void reply.status(status).send({ error: err.message })
  })

  fastify.get('/api/health', async () => ({ ok: true, time: Date.now() }))

  // ---------- events (server → web) ----------
  const clients = new Set<{ send(data: string): void; readyState: number }>()
  const broadcast = (e: ServerEvent) => {
    const data = JSON.stringify(e)
    for (const c of clients) {
      if (c.readyState === 1) c.send(data)
    }
  }
  void fastify.register(async (f) => {
    await f.register(websocket)
    f.get('/events', { websocket: true }, (socket) => {
      clients.add(socket)
      socket.send(JSON.stringify({ type: 'hello', time: Date.now() } satisfies ServerEvent))
      socket.on('close', () => clients.delete(socket))
      socket.on('error', () => clients.delete(socket))
    })
  })

  // ---------- alerts ----------
  const alertStore = new AlertStore(db)
  const extraChannels = deps.channels ?? [new OsChannel()]
  const alerts: AlertEngine = new AlertEngine({
    store: alertStore,
    feed: deps.feed ?? new BybitFeed(config.bybit.wsHost),
    loadCandles: async (q) => (await candles.get(q)).candles,
    channels: [new InAppChannel(broadcast, (id) => alerts.list().find((a) => a.id === id)), ...extraChannels],
    onChange: () => broadcast({ type: 'alerts-changed' }),
    log: (m) => fastify.log.warn(m),
  })

  fastify.get('/api/alerts', async () => ({ alerts: alerts.list() }))

  fastify.post('/api/alerts', async (req) => ({ alert: alerts.create(parseAlertInput(req.body, Date.now())) }))

  fastify.patch('/api/alerts/:id', async (req) => {
    const { id } = req.params as { id: string }
    const status = (req.body as { status?: unknown } | undefined)?.status
    if (status !== 'active' && status !== 'paused') throw bad('status must be active or paused')
    const alert = alerts.setStatus(id, status)
    if (!alert) throw notFound('alert not found')
    return { alert }
  })

  fastify.delete('/api/alerts/:id', async (req) => {
    const { id } = req.params as { id: string }
    if (!alerts.remove(id)) throw notFound('alert not found')
    return { ok: true }
  })

  fastify.get('/api/alerts/history', async (req) => {
    const q = req.query as Record<string, unknown>
    return { history: alertStore.history(parseInt_(q.limit, 'limit', 1, 1000, 200)) }
  })

  fastify.delete('/api/alerts/history', async () => {
    alertStore.clearHistory()
    broadcast({ type: 'alerts-changed' })
    return { ok: true }
  })

  /** Send a sample notification through the OS channel so the user can check that macOS shows it. */
  fastify.post('/api/alerts/test-notification', async () => {
    const os = extraChannels.find((c) => c.id === 'os')
    if (!os) throw notFound('no OS notification channel')
    const now = Date.now()
    await os.send({
      id: 'test', alertId: 'test', category: 'linear', symbol: 'TEST', firedAt: now, price: 0, value: 0, threshold: 0,
      message: 'Test notification — alerts will look like this.',
    })
    return { ok: true }
  })

  /** The web app reports the current lines of a symbol so line alerts follow their drawing. */
  fastify.post('/api/alerts/sync-lines', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const lines = Array.isArray(body.lines) ? body.lines.map(parseLine) : []
    return { updated: alerts.syncLines(parseCategory(body.category), parseSymbol(body.symbol), lines) }
  })

  // ---------- Bybit proxy + cache ----------
  fastify.get('/api/bybit/symbols', async (req) => {
    const q = req.query as Record<string, unknown>
    return market.getSymbols(parseCategory(q.category ?? 'linear'))
  })

  fastify.get('/api/bybit/tickers', async (req) => {
    const q = req.query as Record<string, unknown>
    return market.getTickers(parseCategory(q.category ?? 'linear'))
  })

  fastify.get('/api/bybit/candles', async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const res = await candles.get({
      category: parseCategory(q.category ?? 'linear'),
      symbol: parseSymbol(q.symbol),
      tf: parseTf(q.tf),
      end: q.end === undefined || q.end === '' ? undefined : parseInt_(q.end, 'end', 0, 1e14),
      limit: parseInt_(q.limit, 'limit', 1, 1000, 1000),
    })
    void reply.header('x-providence-source', res.source)
    return { data: res.candles, stale: res.stale, fetchedAt: Date.now() }
  })

  // ---------- key/value store ----------
  fastify.get('/api/store/:key', async (req) => {
    const { key } = req.params as { key: string }
    if (!KEY_RE.test(key)) throw bad('invalid key')
    const row = kv.get<unknown>(key)
    // A missing key is a normal answer (first run), not an error: 200 with `exists: false`.
    if (!row) return { key, exists: false, value: null }
    return { key, exists: true, value: row.value, updatedAt: row.updatedAt }
  })

  fastify.put('/api/store/:key', async (req) => {
    const { key } = req.params as { key: string }
    if (!KEY_RE.test(key)) throw bad('invalid key')
    const body = req.body as { value?: unknown } | undefined
    if (!body || !('value' in body) || body.value === undefined) throw bad('body must be { "value": ... }')
    kv.set(key, body.value)
    return { ok: true }
  })

  fastify.delete('/api/store/:key', async (req) => {
    const { key } = req.params as { key: string }
    if (!KEY_RE.test(key)) throw bad('invalid key')
    return { ok: true, deleted: kv.delete(key) }
  })

  return { fastify, db, rest, candles, market, kv, alerts, broadcast }
}
