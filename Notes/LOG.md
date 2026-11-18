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

## M4 Indicators (2026-11-16)

**Built-in indicator list of klinecharts 9.8.12** (`getSupportedIndicators()`, resolves the open question in chart.md §11):
`AVP AO BIAS BOLL BRAR BBI CCI CR DMA DMI EMV EMA MTM MA MACD OBV PVT PSY ROC RSI SMA KDJ SAR TRIX VOL VR WR`.

| chart.md §2 | How it is provided |
|---|---|
| EMA, SMA, BB, MACD, Volume | built-in (`EMA`, `MA`, `BOLL`, `MACD`, `VOL`) |
| VWAP | **custom** — built-in `AVP` needs turnover and is not a session VWAP |
| ATR | **custom** — not built in |
| RSI | **custom** — built-in `RSI` is the simple-average (Cutler) variant; TradingView/Bybit use Wilder's smoothing |
| Stoch | **custom** — built-in `KDJ` is a different oscillator (adds J, fixed smoothing) |
| extra | Parabolic SAR, CCI, OBV built-ins exposed so the 10-indicator limit is reachable |

**Decisions**
- Custom indicators live in `packages/indicators` as plain objects (`IndicatorDef` + template). The package declares
  the template shape structurally and does not import klinecharts; `apps/web/src/chart/indicators.ts` registers them.
- All custom maths comes from `packages/core` (`rsi`, `atr`, `stoch`, `vwap`) — the same functions the alert engine
  uses. A test compares chart-template output with `computeAlertIndicator` on a fixed candle set (alerts.md §6).
- RSI is verified against the classic Wilder reference series (70.46, 66.25, …) in `core.test.ts`. A live spot-check
  against Bybit's own chart (chart.md §6) was **not** done — it needs a manual look at bybit.com.
- KLineChart allows one indicator of a given name per pane, so SMA/EMA take up to three lengths (0 = off) instead of
  being added several times.
- `setIndicators` is idempotent: it removes and re-creates indicators only when the list or the price precision
  changes. Hidden indicators stay in the cell state but are not created on the chart.
- Max 10 indicators per chart: the picker disables further entries and shows a warning line.
- Indicator and parameter names go through i18n with the def's own label as fallback, so an indicator added to
  `packages/indicators` shows up without touching the translation files.

## M5 Drawings (2026-11-16)

**Built-in overlays of klinecharts 9.8.12** (`getSupportedOverlays()`, 15):
`fibonacciLine, horizontalRayLine, horizontalSegment, horizontalStraightLine, parallelStraightLine, priceChannelLine,
priceLine, rayLine, segment, straightLine, verticalRayLine, verticalSegment, verticalStraightLine, simpleAnnotation, simpleTag`.

Corrected drawings.md §2 table:

| Group | Tools | Source |
|---|---|---|
| Lines | segment (trend line), rayLine, straightLine, horizontal straight/ray/segment, vertical straight/ray/segment, priceLine | built-in |
| Channels | parallelStraightLine, priceChannelLine | built-in |
| Fibonacci | fibonacciLine (retracement) — **the only Fibonacci tool the pinned version ships** | built-in |
| Forecast | longPosition, shortPosition, priceRange, dateRange | custom `registerOverlay` |
| Annotate | simpleAnnotation, simpleTag | built-in |
| Annotate | text, arrow — not built in | custom `registerOverlay` |

**Surprises**
- An overlay point is resolved by `timestamp` when it has one (nearest loaded candle), otherwise by `dataIndex`.
  Points right of the last candle have **no timestamp**, so they cannot be stored in data coordinates as-is and
  would drift as candles arrive. The engine keeps canonical `{timestamp, value}` shapes (future timestamps
  extrapolated with the bar interval, `chart/anchor.ts`) and re-anchors overlays on `onDataReady` whenever the
  loaded range changes: in-range points by timestamp, out-of-range points by extrapolated index.
- Right-click deletes an overlay by default; `onRightClick` returns `true` to stop that.
- The library advances a drawing step on click but tracks the point through mouse-move events — relevant only for
  automated testing (a click with no preceding move does not place the next point).

**Decisions**
- Long/short position: three clicks — entry, stop, take. Until the take is placed it is previewed at 2R.
  R:R and % come from `positionStats` in core (tested against the worked example in drawings.md §4) and are
  recomputed on every redraw, so they update live while dragging. Both tools share one implementation; the colours
  follow the role of each level (stop zone red, target zone green).
- Storage: `drawings:<category>:<symbol>` in the KV store, debounced 500 ms. One store entry per symbol, shared by
  every cell and timeframe; a change in one cell is re-applied to other cells showing the same symbol.
- Undo (Ctrl/Cmd+Z, toolbar button): per-symbol stack of previous drawing lists, depth 50. Not persisted.
  Typing in the text field commits per keystroke, so undo steps back one character at a time.
- Style bar (colour, width, solid/dashed, text, lock, delete) appears while a drawing is selected. Positions have
  fixed colours and only offer lock/delete.
- "Lock all" and "hide all" are per-cell view toggles and are not persisted; per-drawing lock is persisted.
- Magnet = KLineChart `weak_magnet` mode.
- Verified in the browser: long position and trend line drawn with the mouse, restyled, saved, restored after
  reload, unchanged across 1h → 4h → 15m → 1h, Delete key, undo; all 21 tools render without console errors.
  **Not** verified by hand: dragging individual points of every tool, magnet mode, lock/hide toggles beyond state.

## M6 Layouts (2026-11-16)

- Layout switcher in the top bar: 1, 2 (side by side), 4 (2×2). The store always holds four cell states, so switching
  to a smaller layout and back keeps the hidden cells' symbol, timeframe and indicators.
- The active cell (blue frame) is set on mouse-down in the capture phase and receives asset-list clicks and keyboard
  shortcuts (Delete, Esc, Ctrl/Cmd+Z).
- Persisted under `layout`: `{ mode, active, cells[4] }`. Drawings stay per symbol, so two cells showing the same
  symbol share them live (verified: remove in one cell → gone in the other; undo restores both).
- One Bybit WebSocket per category serves all cells (topics multiplexed); redraws are throttled per cell.
- Not done: optional crosshair sync between cells (chart.md §2 marks it optional).
- Known cosmetic limit: in a 4-chart layout on a small window the drawing toolbar can be taller than the cell.

## M7 Alerts (2026-11-16)

**Design**
- `AlertEngine` (apps/server/src/alerts) runs inside the server and reads live data through a `MarketFeed`
  interface; `BybitFeed` implements it on the public WebSocket (`tickers.{symbol}` for price, `kline.{interval}.{symbol}`
  with `confirm=true` for closed candles). Subscriptions follow the set of active alerts.
- Price and line alerts are checked on every ticker update; indicator alerts once per closed candle.
- Conditions: `cross` (either direction), `above`, `below`.
  - Price/line: `above`/`below` are **edge-triggered** (fire on entering the zone, or immediately if already in it when
    the alert is created) — at 10 ticks/s a level check would fire constantly.
  - Indicator: `above`/`below` are checked as a **level at each candle close** (alerts.md: "RSI 14 > 70 on candle
    close, once per candle"); `cross` compares with the previous candle's value.
- De-duplication (alerts.md §6): `lastFiredCandle` is stored with the alert — the candle open time for indicator
  alerts, a 1-minute bucket for price/line alerts. "Every time" price alerts therefore fire at most once per minute.
  Previous observations are kept in memory across WebSocket reconnects, so a reconnect cannot fake a cross.
  After a server restart the first observation of an alert that has fired before only re-arms it.
- Line alerts store the line geometry and the drawing id. The web app posts a symbol's lines to
  `/api/alerts/sync-lines` whenever its drawings change: a moved line updates the alert (without counting the jump as
  a cross), a deleted line pauses it. Line value in time comes from `lineValueAt` in core (segment / ray / extended).
- Indicator alerts support RSI, EMA, SMA, ATR with the shared maths from `packages/core`
  (`computeAlertIndicator`), on 300–1000 closed candles loaded through the server's candle cache.
- Channels implement `AlertChannel`: in-app (server → web over the `/events` WebSocket, toast + panel) and OS.
- Routes: `GET/POST /api/alerts`, `PATCH/DELETE /api/alerts/:id`, `GET/DELETE /api/alerts/history`,
  `POST /api/alerts/sync-lines`, WebSocket `/events`.
- Alert messages are generated on the server in English (they go to the OS notification and the history);
  the alert list in the panel is localised.

**Surprises**
- node-notifier's bundled `terminal-notifier` failed on this Mac: "Could not request notification permission:
  Notifications are not allowed for this application". Added a fallback to AppleScript `display notification` via
  `/usr/bin/osascript`. After that the OS channel logged no error, but **nobody has confirmed that a banner was
  actually shown** — it depends on the notification settings of this Mac.

**Verified on live Bybit data**
- Price alert created in the UI fired 1.1 s after creation (condition already true), toast shown, status → Triggered.
- Line alert on a horizontal line fired on the next tick.
- RSI(14) 1m "every time" alert fired at 21:12:00.637 and 21:13:00.580 UTC — once per candle, ~0.6 s after close.
- Not tested by hand: tab closed while an alert fires (the engine does not depend on the tab), the bell button on
  the drawing style bar, expiry in the UI.

## M8 Export (2026-11-16)

- "Export" menu in each chart header: CSV, JSON, PNG, and "Open exported JSON…".
- CSV: `time,open,high,low,close,volume`, ISO-8601 UTC time, all loaded candles.
- JSON: legacy shape `{ meta, chart: { type: "Candles", tf, data: [[t,o,h,l,c,v]] }, indicators: [{ name, params, data }] }`.
  `meta` = `{ app, version, source, symbol, category, exportedAt }`. Each indicator also carries `keys` (column names
  for `data`), an addition to the documented shape. `[[UI SPEC]] §3` (the original definition) is not in the repo, so
  `meta` and `chart.type` follow export.md's one-line description.
- PNG: `getConvertPictureUrl(true, 'png', background)` — candles, indicators and drawings.
  File names: `SYMBOL_TF_yyyyMMdd-HHmm.ext` (local time).
- Import for viewing: the JSON's candles are shown as a static series in the cell (badge "Imported: …", no paging, no
  live updates) until "Close import". The file's indicator values are **not** drawn; the cell's own indicators are
  recomputed on the imported candles. Drawings of the cell's symbol stay visible on top.
- Verified in the browser: three files with correct names and contents (1000 rows, VOL indicator in JSON, PNG data
  URL), bad file rejected with a message, exported JSON re-opened and closed again.

## After M8: macOS notification follow-up (2026-11-16)

- The user confirmed that no macOS notification appeared. Diagnosis (read-only): `~/Library/Preferences/com.apple.ncprefs.plist`
  lists 142 registered apps; neither `fr.julienxx.oss.terminal-notifier` nor Script Editor is among them (macOS 27.2.1).
  terminal-notifier reports "Notifications are not allowed for this application"; `osascript -e 'display notification …'`
  exits 0 but the notification is dropped. The server cannot detect this.
- Not fixable from code and not something to change on the user's behalf (system notification settings).
  Added: README section "macOS notifications" with the one-time setup, `POST /api/alerts/test-notification`
  (sends through the OS channel only, no history entry) and a button for it in the Alerts panel.
- After allowing notifications for Script Editor, the user confirmed that the test button shows a banner.

## Improvements (2026-11-18)

**Asset list**
- Moved to the right of the charts. Favourites are always on top; the chosen sort applies inside each group.
- Turnover and Funding are optional columns (off by default), switched in the "⋮" menu next to the search; the choice
  is saved with the list preferences. Default sort is now Volume (Turnover is hidden by default); hiding the sorted
  column falls back to it.

**Long / short position (bug fix and rework)**
- Bug: the second click set the *stop*, so dragging a short downwards showed a red, negative zone below; the take was
  derived from the stop (2R), so moving one moved the other; and the % was always long-oriented.
- Now: click 1 = entry, click 2 = target price and end of the forecast. When drawing ends the engine adds the stop as
  a third point, `POSITION_STOP_PX` (40 px) from the entry — fixed, it no longer follows the target. All three points
  are dragged independently; the stop handle sits at the entry's time (left edge).
- % are from the position's point of view (`positionStats(entry, stop, take, side)`): a short's target below the
  entry is positive, its stop above is negative. **Deviation from drawings.md §4**, whose `%stop` formula is the long
  case only; for a short the sign is flipped.
- No minimum width (was ~90 px ≈ 12 bars); a forecast is at least one bar wide.
- Dashed line from the entry to the bar where the target or stop is first touched (green / red), or to the last bar
  inside the window (grey) when neither is touched; nothing when there are no bars after the entry yet. If one bar
  touches both levels the stop is assumed first. Logic: `positionOutcome` in core, unit-tested.
- Saved positions in the old `[entry, stop, take]` order are converted on load (`extendData.v = 2` marks the new
  `[entry, take, stop]` order).
- KLineChart: `convertFromPixel` returns an array even for one coordinate.

**Pivot Points Standard** (TradingView "Pivots"; formulas per
https://www.tradingview.com/support/solutions/43000521824-pivot-points-standard/)
- Types Traditional, Fibonacci, Woodie, Classic, DM, Camarilla; pivots timeframe Auto / Daily / Weekly / Monthly /
  Quarterly / Yearly (Auto: ≤ 15m → daily, other intraday → weekly, 1d → monthly, 1w → yearly); number of pivots back;
  labels (labels and prices / labels / prices / none); line width.
- Maths in `packages/core/src/pivots.ts` (tested); the indicator draws one horizontal segment per level per period
  with its own `draw`, so the levels do **not** stretch the price scale (with figures, R5/S5 squashed the candles).
  The current period extends to its end, like TradingView.
- Periods are UTC (weeks from Monday) and built from the chart's own candles. A period gets levels only when the whole
  previous period is loaded.
- Not ported from the Pine script: Biyearly/Triyearly/Quinquennially/Decennially, "use daily-based values" (crypto
  trades 24/7, so intraday and EOD data agree), per-level colours and visibility, label position right, the
  developing next-period pivots drawn before the period starts.
- Indicator params gained a `select` type (`SelectParam`) and `inCaption: false` to keep display settings out of
  the chip caption.

## Small changes (2026-11-18)

- Layout buttons (1 / 2 / 4 charts) moved from the top bar into the chart header, after "Export". The layout belongs
  to the whole grid, so only the first cell shows them.
- Mouse wheel over the price axis scales the price range (down = wider range / shorter candles, up = narrower),
  like dragging the axis; double-click the axis resets it. KLineChart 9 has no public API for this, so the engine
  calls the internals its own axis drag uses (`getDrawPaneById('candle_pane').getAxisComponent().setRange` +
  `adjustPaneViewport`) — re-check on any klinecharts upgrade. The wheel event is stopped so the time axis does not
  zoom at the same time.
- Fibonacci channel (custom overlay `fibonacciChannel`, Fibonacci group): clicks 1–2 = base trend line, click 3 =
  channel width; levels 0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236 as lines parallel to the
  base, labelled with level and price. The pinned 9.8.12 build has no built-in Fibonacci channel.
