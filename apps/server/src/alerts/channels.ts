import { execFile } from 'node:child_process'
import notifier from 'node-notifier'
import type { Alert, AlertChannel, FiredAlert, ServerEvent } from '@providence/core'

/** In-app channel: pushes the fired alert to every connected web client over the `/events` WebSocket. */
export class InAppChannel implements AlertChannel {
  readonly id = 'in-app'
  constructor(
    private readonly broadcast: (e: ServerEvent) => void,
    private readonly getAlert: (id: string) => Alert | undefined,
  ) {}

  async send(fired: FiredAlert): Promise<void> {
    const alert = this.getAlert(fired.alertId)
    if (alert) this.broadcast({ type: 'alert-fired', fired, alert })
  }
}

/** Quote a string for AppleScript. */
export function appleScriptString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`
}

function notifyWithAppleScript(title: string, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = `display notification ${appleScriptString(message)} with title ${appleScriptString(title)}`
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 5000 }, (err) => (err ? reject(err) : resolve()))
  })
}

/**
 * OS notification (macOS Notification Center). Works with the browser tab closed.
 * node-notifier's bundled terminal-notifier needs its own notification permission; if macOS refuses it,
 * fall back to AppleScript's `display notification`.
 */
export class OsChannel implements AlertChannel {
  readonly id = 'os'
  send(fired: FiredAlert): Promise<void> {
    const title = `Providence — ${fired.symbol}`
    return new Promise<void>((resolve, reject) => {
      notifier.notify({ title, message: fired.message, sound: true, wait: false }, (err) => (err ? reject(err) : resolve()))
    }).catch((err) => {
      if (process.platform !== 'darwin') throw err
      return notifyWithAppleScript(title, fired.message)
    })
  }
}
