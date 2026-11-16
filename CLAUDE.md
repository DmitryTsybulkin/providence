# Providence — rules for AI agents and contributors

Open-source, local-first charting app (a free TradingView alternative for crypto).
Specs live in `docs/Features/` and `docs/Decisions/`. **The docs are the source of truth**; when code or a prompt
disagrees with them, follow the docs and record the deviation in `Notes/LOG.md`.

## Hard rules

1. **Stack**: pnpm monorepo, TypeScript strict. `apps/web` (React + Vite), `apps/server` (Fastify + better-sqlite3),
   `packages/core`, `packages/adapter-bybit`, `packages/indicators`.
2. **Chart library**: `klinecharts` pinned to an exact **9.x** version (not v10). Use v9 docs only: https://v9.klinecharts.com.
   **Only `apps/web/src/chart/` may import `klinecharts`**; everything else goes through the `ChartEngine` interface.
   ESLint enforces this (`no-restricted-imports`).
3. **Data**: Bybit v5 **public** endpoints only. **No API keys anywhere.** Verify every endpoint/field against
   https://bybit-exchange.github.io/docs/v5/intro. REST goes through the local server (proxy + cache);
   live candles come from the Bybit public WebSocket in the browser.
4. **Server binds to `127.0.0.1:4317` only.** No telemetry. No external calls except Bybit.
5. **Never commit** secrets, `.env*`, `data/`, `*.db`, `config.json`. No private strategies, indicators or results in this repo.
6. **UI**: dark theme, EN + RU strings (react-i18next — no hard-coded user-visible text), desktop only.
   Clean and minimal: no glow or blur effects.
7. **Tests**: vitest for pure logic (Bybit mapping, caching, candle-close rules, indicator math, R:R formula).
   **No real network in tests** — inject `fetch`, clocks and sockets.
8. Keep `Notes/LOG.md` (decisions, surprises, doc URLs used) and `Notes/STATUS.md` (milestone checklist) up to date.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | web on http://localhost:5173 + server on 127.0.0.1:4317 |
| `pnpm typecheck` | `tsc --noEmit` in every workspace |
| `pnpm lint` | ESLint |
| `pnpm test` | vitest (pure logic only) |
| `pnpm build` | production build of web and server |

Definition of done for any change: `pnpm typecheck && pnpm test && pnpm build` green.

## Layout

```
apps/web/src/chart/     the only place that touches klinecharts (ChartEngine, overlays, indicator registration)
apps/web/src/           React UI, state (zustand), i18n
apps/server/src/        Fastify routes, SQLite store, candle cache, alert engine
packages/core/          extension-point types, shared models, pure maths (indicators, alerts, R:R)
packages/adapter-bybit/ Bybit mapping, REST client with backoff, WS client, browser DataAdapter
packages/indicators/    custom indicators (plain TS, registered at startup)
```

## Conventions

- A symbol is always identified by its key `category:symbol` (e.g. `linear:BTCUSDT`); spot and linear share names.
- Candles are `{ t, o, h, l, c, v }`, `t` = open time in ms, lists are oldest-first.
- Only **closed** candles are written to the SQLite cache.
- Indicator maths used by both the chart and alerts lives in `packages/core` so the two can never disagree.
