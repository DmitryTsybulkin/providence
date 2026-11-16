import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // Workspace packages ship as TypeScript source, so they must be bundled into the server build.
  noExternal: [/^@providence\//],
})
