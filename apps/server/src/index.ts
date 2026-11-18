import { buildApp } from './app'
import { loadConfig } from './config'

const config = loadConfig()
const app = buildApp({ config, logger: true })

app.fastify
  .listen({ host: config.host, port: config.port })
  .then(() => {
    app.alerts.start()
    app.fastify.log.info(`Providence server on http://${config.host}:${config.port} (db: ${config.dbPath}${config.webDir ? `, web: ${config.webDir}` : ''})`)
  })
  .catch((err) => {
    app.fastify.log.error(err)
    process.exit(1)
  })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.alerts.stop()
    void app.fastify.close().finally(() => {
      app.db.close()
      process.exit(0)
    })
  })
}
