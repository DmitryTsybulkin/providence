# Log

Decisions, surprises and the doc URLs used. Newest milestone at the bottom.

## M0 Scaffold (2026-11-16)

**Docs vs prompt**
- The build prompt says specs are in `docs/`; they are actually in `docs/Features/*.md` and
  `docs/Decisions/ADR-P01 KLineChart as chart library.md`. Followed the files as found.
- The docs link to `[[UI SPEC]]` (§3, §5, §7) which is not in this repo. Nothing in it was needed to proceed;
  where the specs defer to it (banner wording, visual details) the simplest reasonable choice was made.
- architecture.md lists the repo layout without `packages/indicators`; chart.md §4 requires it. Created it.

**Tooling**
- `pnpm` was not installed → enabled through Node's corepack (`corepack enable pnpm`, pnpm 12.21.0).
- pnpm 12 ignores `onlyBuiltDependencies`; build scripts are approved with `allowBuilds` in `pnpm-workspace.yaml`
  (better-sqlite3, esbuild).
- TypeScript pinned to `~6.0`: `typescript-eslint` 8.x does not support TypeScript 7 yet.
- Workspace packages are consumed as TypeScript source (`exports` → `./src/index.ts`): Vite and tsx compile them,
  `tsup` bundles them into the server build. No per-package build step.

**klinecharts version**
- npm `latest` is now 10.1.1 (v10 is stable). The ADR and hard rules say 9.x, upgrade is a separate task →
  pinned exactly `klinecharts@9.8.12` (last 9.x release).

**Type decisions in `packages/core`**
- `DrawingTool.group` gained `'channels'` (drawings.md §2 has a Channels group; architecture §4 omits it).
- `IndicatorDef` gained `label`. `DataAdapter.listSymbols/getTickers` take an optional `category`.
- `DataAdapter` methods take the symbol **key** `category:symbol` (market-data §5: category is part of the key).
- `ChartState` has no `drawings` field: chart.md §3 puts drawings in the cell state, drawings.md §3 stores them per
  symbol under `drawings:<category>:<symbol>` and shares them across timeframes. drawings.md is more specific → followed it.
- `Panel.component` is `React.FC` as specified; core only has a type-level dependency on `@types/react`.

## M1 Data (2026-11-16)

**Bybit docs used** (all under https://bybit-exchange.github.io/docs/v5/)
- `market/kline` — `GET /v5/market/kline`; params `category, symbol, interval, start, end, limit [1,1000]`;
  `list` rows are string arrays `[startTime, open, high, low, close, volume, turnover]`, sorted newest first.
- `market/instrument` — `GET /v5/market/instruments-info`; default page 500, max `limit` 1000, `nextPageCursor`;
  "Spot does not support pagination".
- `market/tickers` — `lastPrice, price24hPcnt, highPrice24h, lowPrice24h, turnover24h, volume24h, fundingRate, nextFundingTime`.
- `websocket/public/kline` — topic `kline.{interval}.{symbol}`, `confirm` = candle closed, push every 1–60 s.
- `websocket/public/ticker` — topic `tickers.{symbol}`; linear sends `snapshot` then `delta` (unchanged fields omitted).
- `ws/connect` — `wss://stream.bybit.com/v5/public/{linear|spot}`, heartbeat `{"op":"ping"}` every 20 s.
- `rate-limit`, `error` — HTTP 429 / `retCode 10006` "Too many visits"; HTTP 403 "access too frequent" = IP ban (~10 min).

**CORS check (asked for in market-data §3)**
- `curl -H "Origin: http://localhost:5173" https://api.bybit.com/v5/market/time` →
  `access-control-allow-origin: http://localhost:5173`, `access-control-allow-credentials: true`.
  **Bybit REST does allow CORS from localhost.** REST still goes through the local server, because the
  server provides the cache, the rate-limit backoff and data for alerts while the tab is closed.

**Surprises**
- Bybit's `linear` category is not only USDT perpetuals: 929 instruments including USDC perps and dated futures.
  Scope says USDT perps → adapter keeps `contractType === 'LinearPerpetual' && quoteCoin === 'USDT'` (821 symbols).
  `/api/bybit/tickers` still returns every linear ticker; the web joins tickers to the symbol list.
- Rate limit `10006` arrives with HTTP 200, so the client inspects `retCode`, not only the status.
- Linear ticker deltas omit `lastPrice` when it did not change → consumers must keep the last value.

**Decisions**
- Routes return an envelope `{ data, stale, fetchedAt }`; `stale: true` = Bybit unreachable, cached data served.
  Upstream failures with nothing cached → HTTP 502 `{ error }`.
- Candle cache answer is decided by a pure function `planCandleFetch` → `cache` | `tail` | `full`:
  a page is served from SQLite only when it is contiguous and complete. For the latest page the closed candles
  come from SQLite and only the forming candle (`start = newest + tf`) is requested from Bybit.
  Measured on BTCUSDT 1h: history page 190 ms from Bybit, 4 ms from cache.
- When Bybit returns fewer rows than asked, the oldest row is remembered as the start of history
  (`cache_meta: history_start:…`) so the oldest page is cacheable too.
- Symbols cache (1 h) is also persisted in SQLite so the asset list works after a restart without network.
- Backoff: 3 retries, 500 ms · 2ⁿ, shared pause across concurrent requests; HTTP 403 → 60 s fail-fast cool-down.
- WS client keeps the socket open 5 s after the last unsubscribe, so switching symbol does not reconnect
  (Bybit asks not to connect/disconnect frequently). One socket per category, all topics multiplexed.
- Gap refetch after reconnect lives in the browser adapter: it replays REST candles from the last seen open time
  (max 1000). A larger hole is detected by the chart (non-contiguous candle) and triggers a reload.
- `config.json` gained `bybit.wsHost` (needed by the alert engine); documented in README.

## M2 Asset list (2026-11-16)

- Table: favourite star, symbol, last, 24h %, turnover, volume, funding (linear only). Default sort: turnover desc.
- Row building (join symbols + tickers, search, favourites filter, sort) is a pure function `buildAssetRows` with tests;
  rows without a ticker always sort last.
- Virtualized with `@tanstack/react-virtual` (≈40 DOM rows for 821 symbols).
- Tickers poll every 5 s while the tab is visible; the server cache is also 5 s, so Bybit sees at most one call per 5 s.
- Persistence: `favourites`, `assetList` (category, sort, favourites-only), `settings` (language), `layout` in `/api/store`.
  Writes are debounced (500 ms) and **disabled until the saved state has been loaded**, so defaults used while the
  server is down can never overwrite saved state. Boot retries every 3 s until the server answers.
- `GET /api/store/:key` for a missing key returns `200 { exists: false, value: null }` instead of 404 —
  a first run is not an error and it keeps the browser console clean.
- Banner: "local server unreachable" (REST call failed / proxy 5xx) or "Bybit unreachable — cached data" (`stale: true`).
  `[[UI SPEC]] §7` (banner design) is not in the repo, so this is a plain one-line bar under the top bar.

## M3 Chart (2026-11-16)

**KLineChart docs/source used**: https://v9.klinecharts.com/en-US/guide/instance-api (`applyNewData`, `updateData`,
`setLoadDataCallback`, `scrollToTimestamp`, `getVisibleRange`, `getConvertPictureUrl`), plus the bundled
`dist/index.d.ts` of 9.8.12 as the final word on signatures.

**Surprises**
- `loadMore` / `applyMoreData` are deprecated since 9.8.0 → used `setLoadDataCallback`. Its naming is inverted from
  what one expects: `forward` = **older** candles (left edge), `backward` = **newer** (right edge).
- `applyNewData` is asynchronous: the data list is swapped in a microtask. Calling `scrollToTimestamp` right after it
  scrolls the *old* list. `ChartEngine.setData` therefore returns a promise (resolved by the library's completion
  callback) and takes the scroll target as an option.
- Right after `applyNewData` the view sits at the newest candle, which immediately fires a "backward" page request.
  The engine holds back right-edge paging until the view has been moved to its target.
- `requestAnimationFrame` never fires in a background tab, so the rAF redraw throttle has a 500 ms timer fallback;
  otherwise live candles would queue up forever while the tab is hidden.

**Decisions**
- `ChartEngine` (apps/web/src/chart/types.ts) exposes no klinecharts types. `CellController` (lib/) owns the data
  flow (load, page older/newer, live, go to date) and is unit-tested against a fake engine and adapter.
- **History window**: "go to date" and a timeframe switch while scrolled back load a 1000-candle window around the
  target instead of everything between the target and now (1m a year back would be 525 000 candles, over the cap).
  The window pages in both directions; while it does not reach the present the cell shows a "History" badge and
  ignores live candles; paging forward until the present re-attaches live updates. "To latest" jumps back.
- 50 000-candle cap (chart.md §4): paging older simply stops at the cap (`more = false`). Trimming the other end
  would need `applyNewData` again, which resets the view — not worth it for the MVP.
- Timeframe switch keeps the right-edge time (chart.md §4): `getRightEdgeTime()` returns the bar that
  `scrollToTimestamp()` places at the right edge, so repeated switches do not drift (verified over 6 switches).
- Live feed hole detection: if a live candle is more than one bar ahead of the chart's last candle, the cell reloads.
- Verified in the browser: BTCUSDT 1h paged back 7 pages (8000 candles, ≈ 11 months) in ~6 s with 0 holes; all 7
  timeframes load; live 1m candle updates.
