import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface ServerConfig {
  port: number
  /** Address to listen on. Always 127.0.0.1, except inside the Docker image (see `resolveHost`). */
  host: string
  dbPath: string
  /** Built web app to serve at `/` (production / Docker). Unset in development, where Vite serves it. */
  webDir?: string
  bybit: { restHost: string; wsHost: string }
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: 4317,
  host: '127.0.0.1',
  dbPath: './data/providence.db',
  bybit: { restHost: 'https://api.bybit.com', wsHost: 'wss://stream.bybit.com' },
}

/** The server binds to loopback only (architecture §6). */
export const HOST = '127.0.0.1'

/**
 * Listen address. Loopback, unless `PROVIDENCE_IN_DOCKER=1` (set only by the Dockerfile): inside a container
 * 127.0.0.1 is unreachable from the host, so the server listens on all container interfaces and the port is
 * published on the host's loopback only (`-p 127.0.0.1:4317:4317`).
 */
export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.PROVIDENCE_IN_DOCKER === '1' ? '0.0.0.0' : HOST
}

/**
 * Reads `config.json` from the server's working directory; missing file or keys fall back to defaults.
 * Environment overrides (used by Docker): PROVIDENCE_PORT, PROVIDENCE_DB_PATH, PROVIDENCE_WEB_DIR.
 */
export function loadConfig(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const file = resolve(cwd, 'config.json')
  let user: Partial<ServerConfig> = {}
  if (existsSync(file)) {
    user = JSON.parse(readFileSync(file, 'utf8')) as Partial<ServerConfig>
  }
  const envPort = Number(env.PROVIDENCE_PORT)
  return {
    port: Number.isInteger(envPort) && envPort > 0 ? envPort : (user.port ?? DEFAULT_CONFIG.port),
    host: resolveHost(env),
    dbPath: resolve(cwd, env.PROVIDENCE_DB_PATH || user.dbPath || DEFAULT_CONFIG.dbPath),
    ...(env.PROVIDENCE_WEB_DIR ? { webDir: resolve(cwd, env.PROVIDENCE_WEB_DIR) } : {}),
    bybit: { ...DEFAULT_CONFIG.bybit, ...user.bybit },
  }
}
