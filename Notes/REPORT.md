# Providence — build report

Date: 2026-11-16. Milestones M0–M8 are implemented and committed, one commit per milestone.
`pnpm typecheck`, `pnpm lint`, `pnpm test` (124 tests, no network) and `pnpm build` are green.

Details, doc URLs and the reasoning behind each decision are in [LOG.md](LOG.md); the checklist is in [STATUS.md](STATUS.md).

## What works

Everything below was exercised in the browser at http://localhost:5173 against live Bybit data unless marked otherwise.

| Area | State |
|---|---|
| Run | `pnpm dev` starts web (:5173) and server; the server listens on `127.0.0.1:4317` only |
| Market data | `/api/bybit/symbols\|tickers\|candles` with caches (symbols 1 h, tickers 5 s, closed candles in SQLite); backoff on 429 / 10006; `/api/store/:key` |
| Live data | Bybit public WebSocket from the browser: ping every 20 s, reconnect with backoff, resubscribe, gap refetch |
| Asset list | Right of the charts; USDT perpetuals and spot; search, sort, favourites on top, optional Turnover/Funding columns, 5 s refresh, virtualized; click selects the symbol |
| Chart | KLineChart 9.8.12 behind `ChartEngine`; 7 timeframes; history paging in both directions (cap 50 000); go to date; live last candle |
| Indicators | SMA, EMA, Bollinger, Parabolic SAR, VWAP, Pivot Points Standard (overlay); Volume, MACD, RSI, Stochastic, ATR, CCI, OBV (pane); params dialog, hide, remove, max 10 |
| Drawings | 21 tools: 15 built-in overlays + custom long/short position (live R:R and %, fixed stop, outcome line), price range, date range, text, arrow; style bar; Delete; undo; saved per symbol, shared across timeframes and cells |
| Layouts | 1 / 2 / 4 charts, each with its own symbol, timeframe and indicators; active cell receives asset-list clicks |
| Alerts | Server-side engine: price cross/above/below, line cross from a drawn horizontal or trend line, indicator (RSI, EMA, SMA, ATR) on candle close; once / every time; expiry; panel with history; in-app toast |
| Export | CSV, JSON (legacy format), PNG; exported JSON can be re-opened for viewing |
| Persistence | Favourites, list preferences, language, layout, drawings and alerts survive a reload and a server restart |
| UI | Dark theme, English and Russian, warning banner when the local server is unreachable |

## What does not work or is not confirmed

- **macOS notifications need a one-time permission.** They were silently dropped until notifications were allowed
  for Script Editor (the sender of the AppleScript fallback); after that the user confirmed the banner from the
  "Send a test macOS notification" button. node-notifier's own `terminal-notifier` is still refused by macOS, so every
  notification currently goes through the fallback. A real alert's notification (as opposed to the test button) has
  not been observed, but it uses the same channel. Setup steps: README, "macOS notifications".
- **"Bybit unreachable" banner is untested.** The "local server unreachable" banner was tested by stopping the
  server. The stale-cache path (`stale: true`) is covered by unit tests only.
- **Reconnect after network off/on was not tested by hand.** WebSocket reconnect, resubscribe and gap refetch are
  covered by unit tests with a fake socket.
- **Alert with the tab closed was not tested by hand.** The engine runs in the server and does not depend on the tab;
  alerts fired while the test page was open.
- **RSI was not spot-checked against Bybit's own chart** (chart.md §6). It matches the standard Wilder reference
  values in a unit test.
- **Drawing interactions tested by hand are limited** to placing a long position, a trend line and a text, restyling,
  selecting, deleting and undo. All 21 tools render, but dragging individual points of each tool, magnet mode and the
  alert-bell button on the style bar were not clicked through.
- Crosshair sync between cells (optional in chart.md) is not implemented.
- Light theme (listed as "Could") is not implemented.

## Deviations from the docs

| Doc | Deviation | Why |
|---|---|---|
| prompt | Specs are in `docs/Features/` and `docs/Decisions/`, not flat in `docs/` | Followed the files as found |
| all | `[[UI SPEC]]` is referenced but not in the repo | Simplest reasonable choice wherever the specs defer to it |
| architecture §3 | Added `packages/indicators` and `bybit.wsHost` in the config | Required by chart.md §4 and by the alert engine |
| architecture §4 | `DrawingTool.group` has `'channels'`; `IndicatorDef` has `label`; `DataAdapter` takes symbol keys `category:symbol` and an optional `category` | drawings.md §2 has a Channels group; category must be part of the key (market-data §5) |
| chart.md §3 | `ChartState` has no `drawings` field | drawings.md §3 stores drawings per symbol, shared across timeframes |
| chart.md §2 | RSI and Stochastic are custom, not built-in | Built-in RSI is not Wilder's; built-in KDJ is a different oscillator |
| chart.md §4 | Go to date / timeframe switch far back loads a 1000-candle window that pages both ways, with live updates paused | Loading everything up to now would exceed the 50 000 cap (1m, one year = 525 000 candles) |
| chart.md §4 | At the 50 000 cap, paging stops; nothing is trimmed | Trimming needs `applyNewData`, which resets the view |
| drawings.md §2 | Only one Fibonacci tool (`fibonacciLine`); text and arrow are custom | That is what the pinned 9.8.12 build ships |
| alerts.md | Price/line `above`/`below` fire on entering the zone; "every time" price alerts fire at most once per minute | A level check on every tick (10/s) would spam |
| alerts.md | Alert messages are English only | They are generated on the server for the OS notification and history |
| export.md | JSON indicators carry an extra `keys` field; imported indicator values are not drawn | Column names are needed to read `data`; the cell recomputes its own indicators |
| market-data | `GET /api/store/:key` returns `200 { exists: false }` for a missing key | A first run is not an error |
| hard rules | TypeScript pinned to 6.0; klinecharts pinned to 9.8.12 although npm `latest` is 10.1.1 | typescript-eslint does not support TS 7; ADR-P01 requires 9.x |

Bybit REST does allow CORS from `http://localhost:5173` (asked for in market-data §3). REST still goes through the
local server for the cache, backoff and tab-closed alerts.

## Known bugs and rough edges

- In a 4-chart layout on a small window the drawing toolbar can be taller than the cell.
- Typing in a text drawing's field creates one undo step per character.
- Undo history is in memory only; it is lost on reload.
- While viewing an imported JSON, drawings of the cell's symbol stay visible on top of the imported candles.
- "Lock all" and "hide all" drawings are not persisted.
- A drawing whose points are older than the loaded candles is drawn at an extrapolated position until that history
  is loaded.
- If a line alert's drawing is deleted the alert is paused; undoing the deletion does not resume it.
- After a server restart, the banner can take up to 15 s to clear (events socket backoff).
- The server does not check the `Origin` header. It binds to loopback only, but any local web page could call it.
- `pnpm` was enabled with `corepack enable pnpm` on this machine during the build.

## Next steps

1. Fire one real alert and confirm its macOS notification; consider running the server as a launchd service (alerts.md §6).
2. Manual pass over every drawing tool (drag points, magnet) and the remaining untested paths listed above.
3. Spot-check EMA/RSI on BTCUSDT 1h against Bybit's chart.
4. Decide the licence (MIT or Apache-2.0) before publishing — architecture §11.
5. Add `[[UI SPEC]]` to the repo or remove the references; check the UI against the Figma reference.
6. Serve the built web app from the server so one process is enough outside development.
7. Later, per the docs: Telegram alert channel, crosshair sync, light theme, upgrade to KLineChart 10 as its own task.
