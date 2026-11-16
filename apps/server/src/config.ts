import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface ServerConfig {
  port: number
  dbPath: string
  bybit: { restHost: string; wsHost: string }
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: 4317,
  dbPath: './data/providence.db',
  bybit: { restHost: 'https://api.bybit.com', wsHost: 'wss://stream.bybit.com' },
}

/** The server binds to loopback only — never configurable (architecture §6). */
export const HOST = '127.0.0.1'

/** Reads `config.json` from the server's working directory; missing file or keys fall back to defaults. */
export function loadConfig(cwd: string = process.cwd()): ServerConfig {
  const file = resolve(cwd, 'config.json')
  let user: Partial<ServerConfig> = {}
  if (existsSync(file)) {
    user = JSON.parse(readFileSync(file, 'utf8')) as Partial<ServerConfig>
  }
  return {
    port: user.port ?? DEFAULT_CONFIG.port,
    dbPath: resolve(cwd, user.dbPath ?? DEFAULT_CONFIG.dbPath),
    bybit: { ...DEFAULT_CONFIG.bybit, ...user.bybit },
  }
}
