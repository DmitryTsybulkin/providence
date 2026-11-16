---
tags: [providence, adr]
status: accepted
date: 2026-11-16
---
# ADR-P01 KLineChart as chart library
## Context
MVP needs candles, indicators and drawing tools (lines, Fibonacci, long/short) by end of November 2026. [[UI SPEC]] originally named night-vision-js.

## Options

| | night-vision-js | KLineChart 9.x |
|---|---|---|
| Drawing tools | none (roadmap: "tool overlays ???") | built-in + `registerOverlay` for custom |
| Indicators | built-in + navy-script | built-in + `registerIndicator` (TS) |
| Maturity | v0.4, "API not finalized" | ~3.9k stars, v9 stable, v10 in beta |
| License | MIT | Apache-2.0 |
| Deps / lang | JS | TypeScript, zero dependencies |

## Decision
> [!success] KLineChart, pinned 9.x, behind `ChartEngine`.

## Consequences
- Drawing work shrinks to custom forecast tools (long/short, ranges).
- navy-script is lost; custom indicators are TS modules (small loss — navy is a JS superset).
- Upgrade to v10 only when stable, as a separate task.
- Repo license unaffected (dependency is permissive).
