/** Live market data for the alert engine, from the Bybit public WebSocket (one socket per category). */
import { BybitWs, klineTopic, mapWsKline, publicWsUrl, tickerTopic, type BybitWsKline, type WsCtor } from '@providence/adapter-bybit'
import type { Candle, Category, Timeframe, Unsubscribe } from '@providence/core'

export interface MarketFeed {
  /** Every last-price update of a symbol. */
  subscribePrice(category: Category, symbol: string, cb: (price: number, time: number) => void): Unsubscribe
  /** Each candle once, when it closes. */
  subscribeClosedCandle(category: Category, symbol: string, tf: Timeframe, cb: (candle: Candle) => void): Unsubscribe
  close(): void
}

export class BybitFeed implements MarketFeed {
  private readonly sockets = new Map<Category, BybitWs>()

  constructor(
    private readonly wsHost: string,
    private readonly WebSocketCtor?: WsCtor,
  ) {}

  private socket(category: Category): BybitWs {
    let ws = this.sockets.get(category)
    if (!ws) {
      ws = new BybitWs({ url: publicWsUrl(this.wsHost, category), WebSocket: this.WebSocketCtor })
      this.sockets.set(category, ws)
    }
    return ws
  }

  subscribePrice(category: Category, symbol: string, cb: (price: number, time: number) => void): Unsubscribe {
    // Linear tickers are snapshot + delta; a delta omits lastPrice when it did not change.
    return this.socket(category).subscribe<{ lastPrice?: string }>(tickerTopic(symbol), (msg) => {
      const price = Number(msg.data?.lastPrice)
      if (msg.data?.lastPrice !== undefined && Number.isFinite(price) && price > 0) cb(price, msg.ts ?? Date.now())
    })
  }

  subscribeClosedCandle(category: Category, symbol: string, tf: Timeframe, cb: (candle: Candle) => void): Unsubscribe {
    return this.socket(category).subscribe<BybitWsKline[]>(klineTopic(tf, symbol), (msg) => {
      for (const item of msg.data) {
        const live = mapWsKline(item)
        if (live.closed) cb(live.candle)
      }
    })
  }

  close(): void {
    for (const ws of this.sockets.values()) ws.close()
    this.sockets.clear()
  }
}
