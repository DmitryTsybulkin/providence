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
