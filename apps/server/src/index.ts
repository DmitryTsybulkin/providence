import { buildApp } from './app'
import { HOST, loadConfig } from './config'

const config = loadConfig()
const app = buildApp({ config, logger: true })

app.fastify
  .listen({ host: HOST, port: config.port })
  .then(() => app.fastify.log.info(`Providence server on http://${HOST}:${config.port} (db: ${config.dbPath})`))
  .catch((err) => {
    app.fastify.log.error(err)
    process.exit(1)
  })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.fastify.close().finally(() => {
      app.db.close()
      process.exit(0)
    })
  })
}
