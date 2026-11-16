import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Candle, Category, Timeframe } from '@providence/core'

export type Db = Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cache_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS candles (
  category TEXT NOT NULL,
  symbol TEXT NOT NULL,
  tf TEXT NOT NULL,
  t INTEGER NOT NULL,
  o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL,
  PRIMARY KEY (category, symbol, tf, t)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_history (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL,
  fired_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alert_history_fired_at ON alert_history (fired_at DESC);
`

/** Opens (and creates) the SQLite database. Pass `:memory:` in tests. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.exec(SCHEMA)
  return db
}

// ---------- key/value (user settings, layouts, drawings) ----------

export class KvStore {
  constructor(
    private readonly db: Db,
    private readonly table: 'kv' | 'cache_meta' = 'kv',
  ) {}

  get<T>(key: string): { value: T; updatedAt: number } | undefined {
    const row = this.db.prepare(`SELECT value, updated_at FROM ${this.table} WHERE key = ?`).get(key) as
      | { value: string; updated_at: number }
      | undefined
    return row ? { value: JSON.parse(row.value) as T, updatedAt: row.updated_at } : undefined
  }

  set(key: string, value: unknown, now: number = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO ${this.table} (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), now)
  }

  delete(key: string): boolean {
    return this.db.prepare(`DELETE FROM ${this.table} WHERE key = ?`).run(key).changes > 0
  }

  keys(prefix = ''): string[] {
    const rows = this.db
      .prepare(`SELECT key FROM ${this.table} WHERE key LIKE ? ESCAPE '\\' ORDER BY key`)
      .all(prefix.replace(/[\\%_]/g, '\\$&') + '%') as { key: string }[]
    return rows.map((r) => r.key)
  }
}

// ---------- candle cache ----------

export class CandleStore {
  constructor(private readonly db: Db) {}

  /** Newest-first rows with open time <= `end`. */
  latest(category: Category, symbol: string, tf: Timeframe, end: number, limit: number): Candle[] {
    return this.db
      .prepare(
        `SELECT t, o, h, l, c, v FROM candles
         WHERE category = ? AND symbol = ? AND tf = ? AND t <= ?
         ORDER BY t DESC LIMIT ?`,
      )
      .all(category, symbol, tf, end, limit) as Candle[]
  }

  upsert(category: Category, symbol: string, tf: Timeframe, candles: Candle[]): void {
    if (candles.length === 0) return
    const stmt = this.db.prepare(
      `INSERT INTO candles (category, symbol, tf, t, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(category, symbol, tf, t) DO UPDATE SET o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v`,
    )
    const run = this.db.transaction((rows: Candle[]) => {
      for (const c of rows) stmt.run(category, symbol, tf, c.t, c.o, c.h, c.l, c.c, c.v)
    })
    run(candles)
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM candles').get() as { n: number }).n
  }
}
