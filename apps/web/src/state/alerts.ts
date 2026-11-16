import { create } from 'zustand'
import {
  parseSymbolKey,
  type Alert, type AlertInput, type AlertLine, type DrawingShape, type FiredAlert, type ServerEvent,
} from '@providence/core'
import { drawingLineKind } from '../chart'
import { useDrawings } from './drawings'

export interface Toast {
  id: string
  fired: FiredAlert
}

interface AlertsState {
  alerts: Alert[]
  history: FiredAlert[]
  toasts: Toast[]
  /** `/events` WebSocket to the local server is open — alerts can reach this tab. */
  connected: boolean
  panelOpen: boolean
  /** Prefill for the create dialog; `null` = closed */
  draft: Partial<AlertInput> | null

  refresh(): Promise<void>
  create(input: AlertInput): Promise<void>
  setStatus(id: string, status: 'active' | 'paused'): Promise<void>
  remove(id: string): Promise<void>
  clearHistory(): Promise<void>
  dismissToast(id: string): void
  togglePanel(): void
  openDraft(draft: Partial<AlertInput>): void
  closeDraft(): void
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/alerts${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

const TOAST_MS = 10_000

export const useAlerts = create<AlertsState>((set, get) => ({
  alerts: [],
  history: [],
  toasts: [],
  connected: false,
  panelOpen: false,
  draft: null,

  async refresh() {
    try {
      const [a, h] = await Promise.all([api<{ alerts: Alert[] }>(''), api<{ history: FiredAlert[] }>('/history?limit=200')])
      set({ alerts: a.alerts, history: h.history })
    } catch {
      // server unreachable; the banner says so
    }
  },
  async create(input) {
    await api('', { method: 'POST', body: JSON.stringify(input) })
    await get().refresh()
  },
  async setStatus(id, status) {
    await api(`/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    await get().refresh()
  },
  async remove(id) {
    await api(`/${id}`, { method: 'DELETE' })
    await get().refresh()
  },
  async clearHistory() {
    await api('/history', { method: 'DELETE' })
    await get().refresh()
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  openDraft: (draft) => set({ draft }),
  closeDraft: () => set({ draft: null }),
}))

/** A drawing as an alert line, or `null` if it is not a horizontal or trend line. */
export function shapeToLine(shape: DrawingShape): AlertLine | null {
  const kind = drawingLineKind(shape)
  if (!kind) return null
  const need = kind === 'horizontal' ? 1 : 2
  if (shape.points.length < need) return null
  return { drawingId: shape.id, kind, points: shape.points.slice(0, need) }
}

/** Connect to the server's event stream; reconnects forever. Returns a stop function. */
export function connectEvents(): () => void {
  let ws: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let attempt = 0

  const open = () => {
    if (stopped) return
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events`)
    ws.onopen = () => {
      attempt = 0
      useAlerts.setState({ connected: true })
      void useAlerts.getState().refresh()
    }
    ws.onmessage = (ev) => {
      let event: ServerEvent
      try {
        event = JSON.parse(String(ev.data)) as ServerEvent
      } catch {
        return
      }
      if (event.type === 'alert-fired') {
        const toast: Toast = { id: event.fired.id, fired: event.fired }
        useAlerts.setState((s) => ({ toasts: [...s.toasts, toast].slice(-5) }))
        setTimeout(() => useAlerts.getState().dismissToast(toast.id), TOAST_MS)
        void useAlerts.getState().refresh()
      } else if (event.type === 'alerts-changed') {
        void useAlerts.getState().refresh()
      }
    }
    ws.onclose = () => {
      useAlerts.setState({ connected: false })
      if (stopped) return
      timer = setTimeout(open, Math.min(15_000, 1000 * 2 ** attempt++))
    }
    ws.onerror = () => ws?.close()
  }
  open()

  // Keep line alerts attached to their drawings: report a symbol's lines whenever its drawings change.
  const offDrawings = useDrawings.subscribe((state, prev) => {
    for (const [key, entry] of Object.entries(state.entries)) {
      if (prev.entries[key] === entry || entry.origin === 'load') continue
      const { category, symbol } = parseSymbolKey(key)
      const hasLineAlert = useAlerts.getState().alerts.some((a) => a.type === 'line' && a.category === category && a.symbol === symbol)
      if (!hasLineAlert) continue
      const lines = entry.shapes.map(shapeToLine).filter((l): l is AlertLine => l !== null)
      void api('/sync-lines', { method: 'POST', body: JSON.stringify({ category, symbol, lines }) }).catch(() => {})
    }
  })

  return () => {
    stopped = true
    offDrawings()
    if (timer) clearTimeout(timer)
    ws?.close()
  }
}
