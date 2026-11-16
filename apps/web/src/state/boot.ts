import { create } from 'zustand'
import { loadLayout } from './layout'
import { loadMarketPrefs } from './market'
import { loadSettings } from './settings'

interface BootState {
  /** Saved state has been loaded from the server (or the server confirmed there is none). */
  hydrated: boolean
  /** The local server could not be reached while loading saved state. */
  serverDown: boolean
}

export const useBoot = create<BootState>(() => ({ hydrated: false, serverDown: false }))

const RETRY_MS = 3_000

/**
 * Load saved settings, favourites and layout. Until this succeeds nothing is written back,
 * so an unreachable server can never cause saved state to be replaced by defaults.
 */
export async function boot(): Promise<void> {
  for (;;) {
    try {
      await Promise.all([loadSettings(), loadMarketPrefs(), loadLayout()])
      useBoot.setState({ hydrated: true, serverDown: false })
      return
    } catch {
      useBoot.setState({ serverDown: true })
      await new Promise((r) => setTimeout(r, RETRY_MS))
    }
  }
}
