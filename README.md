# Providence

Open-source, local-first charting app — a free TradingView alternative for crypto.
Runs entirely on your machine: a React web app plus a tiny local server. Market data comes from
Bybit's **public** API; no account and no API keys are needed.

## Features

- Asset list for Bybit USDT perpetuals and spot: search, sort, favourites
- Candle charts (KLineChart 9.x), timeframes 1m – 1w, history paging, go to date
- Indicators (overlay and separate pane) with editable parameters; custom indicators as plain TypeScript
- Drawing tools: lines, channels, Fibonacci, long/short position with live R:R, price/date range, text
- 1 / 2 / 4 chart layouts
- Alerts on price, drawn lines and indicators — evaluated by the local server, delivered in-app and as macOS notifications
- Export to CSV, JSON and PNG
- English and Russian UI

## Requirements

- Node.js 22 or newer
- pnpm (`corepack enable pnpm`)

## Run

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. The server listens on `127.0.0.1:4317` only.

Optional configuration: copy `apps/server/config.example.json` to `apps/server/config.json`.

| Key | Default | Meaning |
|---|---|---|
| `port` | `4317` | server port (always bound to 127.0.0.1) |
| `dbPath` | `./data/providence.db` | SQLite file with settings, layouts, drawings, alerts and the candle cache |
| `bybit.restHost` | `https://api.bybit.com` | Bybit REST host |
| `bybit.wsHost` | `wss://stream.bybit.com` | Bybit WebSocket host (used by the alert engine) |

## Develop

```bash
pnpm typecheck   # TypeScript in every workspace
pnpm lint        # ESLint
pnpm test        # unit tests (no network)
pnpm build       # production build
```

Specs are in [`docs/`](docs). Project rules are in [`CLAUDE.md`](CLAUDE.md). Progress is tracked in [`Notes/STATUS.md`](Notes/STATUS.md).

## Privacy

No telemetry. The only outbound connections are to Bybit's public REST and WebSocket endpoints.

## License

Not chosen yet (MIT or Apache-2.0) — see `docs/Features/architecture.md` §11.
