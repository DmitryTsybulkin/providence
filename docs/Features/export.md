---
feature: export
project: providence
status: draft
tasks: []
code: []
related: [chart]
updated: 2026-11-16
---
# Export & screenshots
> [!abstract] TL;DR
> Export loaded candles (CSV/JSON) or candles + indicator values (JSON in the legacy Tradebot format), and save a PNG screenshot of a chart. Should, after the 6 Musts.

## Formats
- CSV: `time,open,high,low,close,volume` (ISO time, UTC).
- JSON: legacy shape from [[UI SPEC]] §3 note: `{ meta, chart: { type, tf, data: [[t,o,h,l,c,v]] }, indicators: [{ name, params, data: [[t, v...]] }] }` — also the future bot → UI contract.
- PNG: canvas snapshot incl. indicators and drawings, filename `SYMBOL_TF_yyyyMMdd-HHmm.png`.

## Definition of done
- [ ] All three exports from the chart menu; JSON re-importable for viewing
