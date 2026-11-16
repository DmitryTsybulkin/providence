/**
 * Drawings are stored per symbol and shared across timeframes and chart cells (drawings.md §3):
 * key `drawings:<category>:<symbol>` in the server KV store.
 */
import { create } from 'zustand'
import type { DrawingShape } from '@providence/core'
import { createSaver, loadKey } from '../api/store'

export const UNDO_DEPTH = 50

/** Who produced the current shapes: a cell index, the initial load, or an undo. */
export type DrawingOrigin = number | 'load' | 'undo'

export interface DrawingEntry {
  shapes: DrawingShape[]
  origin: DrawingOrigin
  rev: number
}

interface DrawingsState {
  entries: Record<string, DrawingEntry>
  undoStacks: Record<string, DrawingShape[][]>
  ensureLoaded(symbolKey: string): Promise<void>
  /** Record a user change coming from cell `origin`; the previous state becomes undoable. */
  commit(symbolKey: string, shapes: DrawingShape[], origin: number): void
  /** Revert the last change for a symbol. Returns false when there is nothing to undo. */
  undo(symbolKey: string): boolean
}

type Saver = ReturnType<typeof createSaver<DrawingShape[]>>
const savers = new Map<string, Saver>()
const loading = new Map<string, Promise<void>>()

const saverFor = (symbolKey: string): Saver => {
  let saver = savers.get(symbolKey)
  if (!saver) {
    saver = createSaver<DrawingShape[]>(`drawings:${symbolKey}`)
    savers.set(symbolKey, saver)
  }
  return saver
}

export function sanitizeShapes(value: unknown): DrawingShape[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (s): s is DrawingShape =>
      !!s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.points) &&
      s.points.every((p: unknown) => {
        const q = p as { timestamp?: unknown; value?: unknown }
        return !!q && Number.isFinite(q.timestamp) && Number.isFinite(q.value)
      }),
  )
}

export const useDrawings = create<DrawingsState>((set, get) => ({
  entries: {},
  undoStacks: {},

  ensureLoaded(symbolKey) {
    if (get().entries[symbolKey]) return Promise.resolve()
    let p = loading.get(symbolKey)
    if (!p) {
      p = loadKey<unknown>(`drawings:${symbolKey}`)
        .then((value) => {
          saverFor(symbolKey).enable()
          return sanitizeShapes(value)
        })
        // Server unreachable: start empty but keep saving disabled so nothing saved gets overwritten.
        .catch(() => [] as DrawingShape[])
        .then((shapes) => {
          if (!get().entries[symbolKey]) {
            set((s) => ({ entries: { ...s.entries, [symbolKey]: { shapes, origin: 'load', rev: 0 } } }))
          }
        })
        .finally(() => loading.delete(symbolKey))
      loading.set(symbolKey, p)
    }
    return p
  },

  commit(symbolKey, shapes, origin) {
    const prev = get().entries[symbolKey]
    set((s) => ({
      entries: { ...s.entries, [symbolKey]: { shapes, origin, rev: (prev?.rev ?? 0) + 1 } },
      undoStacks: {
        ...s.undoStacks,
        [symbolKey]: [...(s.undoStacks[symbolKey] ?? []), prev?.shapes ?? []].slice(-UNDO_DEPTH),
      },
    }))
    saverFor(symbolKey).save(shapes)
  },

  undo(symbolKey) {
    const stack = get().undoStacks[symbolKey] ?? []
    if (stack.length === 0) return false
    const shapes = stack[stack.length - 1]
    const prev = get().entries[symbolKey]
    set((s) => ({
      entries: { ...s.entries, [symbolKey]: { shapes, origin: 'undo', rev: (prev?.rev ?? 0) + 1 } },
      undoStacks: { ...s.undoStacks, [symbolKey]: stack.slice(0, -1) },
    }))
    saverFor(symbolKey).save(shapes)
    return true
  },
}))
