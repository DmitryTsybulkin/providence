/** Client for the local server's key/value store (`/api/store/:key`). */

export class StoreUnavailableError extends Error {}

export async function loadKey<T>(key: string): Promise<T | undefined> {
  let res: Response
  try {
    res = await fetch(`/api/store/${encodeURIComponent(key)}`)
  } catch (err) {
    throw new StoreUnavailableError(String(err))
  }
  if (!res.ok) throw new StoreUnavailableError(`HTTP ${res.status}`)
  const body = (await res.json()) as { exists: boolean; value: T }
  return body.exists ? body.value : undefined
}

export async function saveKey(key: string, value: unknown): Promise<void> {
  const res = await fetch(`/api/store/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) throw new StoreUnavailableError(`HTTP ${res.status}`)
}

/**
 * Debounced writer for one key. Nothing is written until `enable()` is called, so defaults used
 * while the server was unreachable can never overwrite the saved state.
 */
export function createSaver<T>(key: string, delayMs = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: T | undefined
  let enabled = false
  const flush = () => {
    timer = null
    if (pending === undefined) return
    const value = pending
    pending = undefined
    saveKey(key, value).catch(() => {
      // Server unreachable: keep the value and retry on the next change.
      if (pending === undefined) pending = value
    })
  }
  return {
    enable() {
      enabled = true
    },
    save(value: T) {
      if (!enabled) return
      pending = value
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    flush() {
      if (timer) clearTimeout(timer)
      flush()
    },
  }
}
