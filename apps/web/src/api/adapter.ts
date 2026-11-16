import { createBybitAdapter } from '@providence/adapter-bybit'

/** The single market-data adapter instance (DataAdapter extension point). */
export const adapter = createBybitAdapter({ apiBase: '/api' })
