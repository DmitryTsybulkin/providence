# Providence

Open-source, local-first charting app for crypto — a free alternative to TradingView's charts.

Everything runs on your own machine: a React web app plus a small local server that stores your settings, caches
market data and evaluates alerts. Market data comes from **Bybit's public API**: no account, no API keys, no
telemetry.

## Features

- **Markets list** — Bybit USDT perpetuals and spot with last price, 24h change and volume (turnover and funding as
  optional columns); search, sort, favourites pinned to the top, refreshed every 5 s.
- **Charts** — candles on 1m, 5m, 15m, 1h, 4h, 1d, 1w; scroll back through history (loaded on demand), go to a date,
  live last candle; zoom the price axis by dragging it or with the mouse wheel.
- **Indicators** — SMA, EMA, Bollinger Bands, Parabolic SAR, VWAP, Pivot Points Standard on the chart; Volume, MACD,
  RSI, Stochastic, ATR, CCI, OBV in their own panes. Editable parameters, show/hide, up to 10 per chart.
  Custom indicators are plain TypeScript files in `packages/indicators`.
- **Drawing tools** — trend lines, rays, horizontal/vertical lines, channels, Fibonacci retracement and channel,
  long/short position with live R:R and %, price and date ranges, text, annotations, arrows. Restyle, lock, delete,
  undo (Ctrl/Cmd+Z). Drawings are saved per symbol and shared across timeframes.
- **Layouts** — 1, 2 or 4 charts, each with its own symbol, timeframe and indicators.
- **Alerts** — price crosses / rises above / falls below, price crosses a drawn line, indicator value on candle close
  (RSI, EMA, SMA, ATR). Once or every time, optional expiry, history. Evaluated by the local server, so they keep
  working with the browser tab closed; delivered in the app and as a macOS notification.
- **Export** — candles as CSV, candles + indicator values as JSON, chart screenshot as PNG; exported JSON can be
  opened again for viewing.
- English and Russian interface, dark theme.

## How it works

```
Browser (React + KLineChart)  ──REST /api──▶  Local server (Fastify + SQLite)  ──▶  Bybit public REST
        │                     ◀──WS /events── (alerts)          │
        └── live candles ──▶ Bybit public WebSocket              └── alert engine ──▶ Bybit public WebSocket
```

- The **server** proxies and caches Bybit REST (symbols 1 h, tickers 5 s, closed candles permanently in SQLite),
  stores settings, layouts, drawings and alerts, and runs the alert engine.
- The **web app** draws charts with [KLineChart](https://github.com/klinecharts/KLineChart) 9 and gets live candles
  straight from Bybit's public WebSocket.

| Path | What it is |
|---|---|
| `apps/web` | React + Vite web app |
| `apps/server` | Fastify server, SQLite store, candle cache, alert engine |
| `packages/core` | shared types and maths (indicators, alerts, position R:R, pivots) |
| `packages/adapter-bybit` | Bybit REST/WebSocket client and data mapping |
| `packages/indicators` | custom indicators |
| `docs/` | feature specs and decisions |

## Run with Docker

Requires Docker (Docker Desktop, OrbStack, Colima…).

```bash
docker compose up -d --build
```

Open http://localhost:4317. Data (settings, drawings, alerts, candle cache) is kept in the `providence-data` volume.

Without Compose:

```bash
docker build -t providence .
```

```bash
docker run -d --name providence -p 127.0.0.1:4317:4317 -v providence-data:/data providence
```

Stop with `docker compose down` (or `docker stop providence`); the data volume is kept.

> [!important]
> Publish the port on `127.0.0.1` as shown. Providence has no login; publishing on all interfaces would let anyone on
> your network change your settings and alerts.

In Docker, alerts still fire and show up in the app, but **macOS notifications are not available** — a container
cannot reach the Mac's Notification Center. Run Providence without Docker if you want system notifications.

## Run without Docker

Requires **Node.js 22+** and **pnpm** (`corepack enable pnpm`).

```bash
pnpm install
```

**Use it** (production build, one process):

```bash
pnpm build && pnpm start
```

Open http://localhost:4317.

**Develop** (hot reload, web on :5173 + server on :4317):

```bash
pnpm dev
```

Open http://localhost:5173.

### Configuration

Optional: copy `apps/server/config.example.json` to `apps/server/config.json`.

| Key | Default | Meaning |
|---|---|---|
| `port` | `4317` | server port |
| `dbPath` | `./data/providence.db` | SQLite file (relative to `apps/server`) |
| `bybit.restHost` | `https://api.bybit.com` | Bybit REST host |
| `bybit.wsHost` | `wss://stream.bybit.com` | Bybit WebSocket host (alert engine) |

Environment variables `PROVIDENCE_PORT`, `PROVIDENCE_DB_PATH` and `PROVIDENCE_WEB_DIR` (folder of the built web app
to serve) override the file. Outside Docker the server only ever listens on `127.0.0.1`.

### macOS notifications

macOS only shows notifications from apps it has registered and drops the rest **silently**. Providence sends through
`terminal-notifier` (bundled with node-notifier) and falls back to AppleScript, which shows up as *Script Editor*.
One-time setup:

1. Open **Script Editor** (in /Applications/Utilities), paste `display notification "hello" with title "Providence"`
   and press Run. When macOS asks whether Script Editor may send notifications, choose **Allow**.
2. In **System Settings → Notifications → Script Editor**, allow notifications (style Banners or Alerts).
3. Make sure no Focus mode (Do Not Disturb) is on.
4. In Providence open **Alerts** and press **Send a test macOS notification**.

## Development

```bash
pnpm typecheck   # TypeScript in every workspace
pnpm lint        # ESLint
pnpm test        # unit tests (no network)
pnpm build       # production build
```

Specs are in [`docs/`](docs), project rules in [`CLAUDE.md`](CLAUDE.md), decisions in [`Notes/LOG.md`](Notes/LOG.md)
and the current state in [`Notes/REPORT.md`](Notes/REPORT.md).

## Privacy

No telemetry and no accounts. The only outbound connections are to Bybit's public REST and WebSocket endpoints.

## License

Not chosen yet (MIT or Apache-2.0) — see `docs/Features/architecture.md` §11.
