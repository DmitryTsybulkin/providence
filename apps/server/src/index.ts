import Fastify from 'fastify'
import { HOST, loadConfig } from './config'

const config = loadConfig()
const app = Fastify({ logger: { level: 'info' } })

app.get('/api/health', async () => ({ ok: true, time: Date.now() }))

app.listen({ host: HOST, port: config.port }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
