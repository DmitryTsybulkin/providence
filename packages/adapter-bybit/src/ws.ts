/**
 * Bybit v5 public WebSocket client: one connection, many topics.
 * - heartbeat `{"op":"ping"}` every 20 s (https://bybit-exchange.github.io/docs/v5/ws/connect)
 * - auto-reconnect with exponential backoff, resubscribes every topic after reconnect
 * - reports status changes and reconnects so callers can refetch the gap over REST
 * Works in the browser and in Node ≥ 22 (global WebSocket); the constructor is injectable for tests.
 */

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting'

export interface WsLike {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((ev: any) => void) | null
  onclose: ((ev: any) => void) | null
  onerror: ((ev: any) => void) | null
  onmessage: ((ev: { data: any }) => void) | null
}
export type WsCtor = new (url: string) => WsLike

export interface BybitWsOptions {
  url: string
  WebSocket?: WsCtor
  /** Heartbeat period. Bybit recommends 20 s. */
  pingMs?: number
  /** Reconnect when nothing (not even a pong) arrived for this long. */
  staleMs?: number
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  /** Keep the socket open this long after the last unsubscribe (avoids connect/disconnect churn on symbol switch). */
  idleCloseMs?: number
}

export interface WsMessage<T = unknown> {
  topic: string
  type?: string
  ts?: number
  data: T
}
type Handler = (msg: WsMessage<any>) => void

/** Bybit limits the number of args per subscribe request (10 on spot). */
export const SUBSCRIBE_CHUNK = 10
const OPEN = 1

export function reconnectDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** attempt)
}

export class BybitWs {
  private readonly opts: Required<Omit<BybitWsOptions, 'WebSocket'>>
  private readonly Ctor: WsCtor
  private ws: WsLike | null = null
  private readonly handlers = new Map<string, Set<Handler>>()
  private readonly statusListeners = new Set<(s: WsStatus) => void>()
  private readonly reconnectListeners = new Set<() => void>()
  private status_: WsStatus = 'idle'
  private attempt = 0
  private everOpened = false
  private lastMessageAt = 0
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUser = false

  constructor(options: BybitWsOptions) {
    this.opts = {
      url: options.url,
      pingMs: options.pingMs ?? 20_000,
      staleMs: options.staleMs ?? 45_000,
      reconnectBaseMs: options.reconnectBaseMs ?? 1_000,
      reconnectMaxMs: options.reconnectMaxMs ?? 30_000,
      idleCloseMs: options.idleCloseMs ?? 5_000,
    }
    const Ctor = options.WebSocket ?? (globalThis as { WebSocket?: WsCtor }).WebSocket
    if (!Ctor) throw new Error('No WebSocket implementation available')
    this.Ctor = Ctor
  }

  get status(): WsStatus {
    return this.status_
  }

  get topics(): string[] {
    return [...this.handlers.keys()]
  }

  onStatus(cb: (s: WsStatus) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  /** Called after the connection is re-established (not on the first connect). */
  onReconnect(cb: () => void): () => void {
    this.reconnectListeners.add(cb)
    return () => this.reconnectListeners.delete(cb)
  }

  /** Subscribe to a topic. Connects lazily; the returned function unsubscribes. */
  subscribe<T>(topic: string, handler: (msg: WsMessage<T>) => void): () => void {
    let set = this.handlers.get(topic)
    const isNewTopic = !set
    if (!set) {
      set = new Set()
      this.handlers.set(topic, set)
    }
    set.add(handler as Handler)
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (!this.ws && !this.reconnectTimer) this.connect()
    else if (isNewTopic && this.ws?.readyState === OPEN) this.sendOp('subscribe', [topic])

    return () => {
      const current = this.handlers.get(topic)
      if (!current) return
      current.delete(handler as Handler)
      if (current.size > 0) return
      this.handlers.delete(topic)
      if (this.ws?.readyState === OPEN) this.sendOp('unsubscribe', [topic])
      if (this.handlers.size === 0 && !this.idleTimer) {
        this.idleTimer = setTimeout(() => {
          this.idleTimer = null
          if (this.handlers.size === 0) this.disconnect()
        }, this.opts.idleCloseMs)
      }
    }
  }

  /** Close the socket and stop reconnecting. A later `subscribe` connects again. */
  close(): void {
    this.handlers.clear()
    this.disconnect()
  }

  private disconnect(): void {
    this.closedByUser = true
    this.clearTimers()
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null
      try {
        ws.close()
      } catch {
        // already closed
      }
    }
    this.everOpened = false
    this.attempt = 0
    this.setStatus('idle')
  }

  private connect(): void {
    this.closedByUser = false
    this.setStatus(this.everOpened ? 'reconnecting' : 'connecting')
    let ws: WsLike
    try {
      ws = new this.Ctor(this.opts.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      const wasReconnect = this.everOpened
      this.everOpened = true
      this.attempt = 0
      this.lastMessageAt = Date.now()
      this.setStatus('open')
      const topics = this.topics
      for (let i = 0; i < topics.length; i += SUBSCRIBE_CHUNK) {
        this.sendOp('subscribe', topics.slice(i, i + SUBSCRIBE_CHUNK))
      }
      this.startHeartbeat()
      if (wasReconnect) this.reconnectListeners.forEach((cb) => cb())
    }
    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now()
      let msg: Partial<WsMessage> & { op?: string }
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data))
      } catch {
        return
      }
      if (typeof msg.topic !== 'string') return // pong / subscribe ack
      const set = this.handlers.get(msg.topic)
      if (set) for (const h of [...set]) h(msg as WsMessage)
    }
    ws.onerror = () => {
      // `onclose` follows; reconnect is handled there.
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.stopHeartbeat()
      if (!this.closedByUser) this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting')
    const delay = reconnectDelay(this.attempt, this.opts.reconnectBaseMs, this.opts.reconnectMaxMs)
    this.attempt++
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closedByUser) this.connect()
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.pingTimer = setInterval(() => {
      const ws = this.ws
      if (!ws || ws.readyState !== OPEN) return
      if (Date.now() - this.lastMessageAt > this.opts.staleMs) {
        // Half-open connection: no data and no pong. Drop it and reconnect.
        ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null
        try {
          ws.close()
        } catch {
          // ignore
        }
        this.ws = null
        this.stopHeartbeat()
        this.scheduleReconnect()
        return
      }
      this.send({ op: 'ping' })
    }, this.opts.pingMs)
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private clearTimers(): void {
    this.stopHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private sendOp(op: 'subscribe' | 'unsubscribe', args: string[]): void {
    if (args.length) this.send({ op, args })
  }

  private send(payload: unknown): void {
    try {
      this.ws?.send(JSON.stringify(payload))
    } catch {
      // socket went away; onclose will reconnect
    }
  }

  private setStatus(s: WsStatus): void {
    if (s === this.status_) return
    this.status_ = s
    this.statusListeners.forEach((cb) => cb(s))
  }
}
