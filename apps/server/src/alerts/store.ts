import type { Alert, FiredAlert } from '@providence/core'
import type { Db } from '../db'

/** Alerts and their firing history in SQLite. Alerts are stored as JSON documents. */
export class AlertStore {
  constructor(private readonly db: Db) {}

  list(): Alert[] {
    const rows = this.db.prepare('SELECT data FROM alerts ORDER BY created_at DESC').all() as { data: string }[]
    return rows.map((r) => JSON.parse(r.data) as Alert)
  }

  get(id: string): Alert | undefined {
    const row = this.db.prepare('SELECT data FROM alerts WHERE id = ?').get(id) as { data: string } | undefined
    return row ? (JSON.parse(row.data) as Alert) : undefined
  }

  save(alert: Alert): void {
    this.db
      .prepare(
        `INSERT INTO alerts (id, data, created_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run(alert.id, JSON.stringify(alert), alert.createdAt)
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM alerts WHERE id = ?').run(id).changes > 0
  }

  addHistory(fired: FiredAlert): void {
    this.db
      .prepare('INSERT INTO alert_history (id, alert_id, fired_at, data) VALUES (?, ?, ?, ?)')
      .run(fired.id, fired.alertId, fired.firedAt, JSON.stringify(fired))
  }

  history(limit = 200): FiredAlert[] {
    const rows = this.db.prepare('SELECT data FROM alert_history ORDER BY fired_at DESC LIMIT ?').all(limit) as { data: string }[]
    return rows.map((r) => JSON.parse(r.data) as FiredAlert)
  }

  clearHistory(): void {
    this.db.prepare('DELETE FROM alert_history').run()
  }
}
