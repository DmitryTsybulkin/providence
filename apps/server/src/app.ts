import Fastify, { type FastifyInstance } from 'fastify'
import { BybitRest } from '@providence/adapter-bybit'
import { CATEGORIES, TIMEFRAMES, type Category, type Timeframe } from '@providence/core'
import { CandleService } from './candles'
import type { ServerConfig } from './config'
import { CandleStore, KvStore, openDb, type Db } from './db'
import { MarketService } from './market'

export interface AppDeps {
  config: ServerConfig
  db?: Db
  rest?: BybitRest
  logger?: boolean
}

export interface App {
  fastify: FastifyInstance
  db: Db
  rest: BybitRest
  candles: CandleService
  market: MarketService
  kv: KvStore
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

  return { fastify, db, rest, candles, market, kv }
}
