# Status

- [x] M0 Scaffold — `pnpm dev` serves web on :5173 and server on 127.0.0.1:4317; core extension-point types; lint rule for klinecharts imports
- [x] M1 Data — Bybit adapter (mapping, REST backoff, WS client), `/api/bybit/symbols|tickers|candles`, SQLite candle cache, `/api/store/:key`
- [x] M2 Asset list — search, sort, favourites (persisted), linear/spot, 5 s refresh, virtualized, click selects symbol, stale banner
- [x] M3 Chart — ChartEngine + KLineChart 9.8.12, 7 timeframes, paging both ways (cap 50 000), go-to-date, live candle, state persisted
- [x] M4 Indicators — picker, overlay + pane, params dialog, hide/remove, max 10; custom VWAP, ATR, RSI (Wilder), Stochastic via registerIndicator
- [x] M5 Drawings — left toolbar (21 tools: 15 built-in + 6 custom), long/short with live R:R and %, price/date range, style bar, delete, undo, per-symbol persistence shared across timeframes
- [x] M6 Layouts — 1 / 2 / 4 charts, per-cell symbol + tf + indicators, active cell receives asset clicks, persisted
- [x] M7 Alerts — server engine on Bybit WS; price, line-cross and indicator (candle close) alerts; once/every, expiry; panel with history; in-app + OS notification
- [ ] M8 Export
