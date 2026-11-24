/**
 * Entry point: start the SDK client, then serve HTTP.
 *
 * Env: COPILOT_GATEWAY_SECRET (required), PORT (default 8080).
 */

import { Redactor, createLog } from './log.js'
import { startSdkClient } from './sdk-client.js'
import { createGatewayServer } from './server.js'
import { TurnManager } from './turns.js'

async function main(): Promise<void> {
  const secret = process.env.COPILOT_GATEWAY_SECRET?.trim() ?? ''
  const port = Number(process.env.PORT ?? 8080)
  const redactor = new Redactor()
  redactor.add(secret)
  const log = createLog(redactor)

  if (secret.length < 32) {
    log('error', 'COPILOT_GATEWAY_SECRET must be set to at least 32 characters')
    process.exit(1)
  }

  const sdk = await startSdkClient()
  const turns = new TurnManager({ client: sdk.client, log, redactor })
  const server = createGatewayServer({
    secret,
    turns,
    log,
    health: async () => {
      try {
        return { ok: true, sdkVersion: sdk.sdkVersion, runtimeVersion: await sdk.runtimeVersion() }
      } catch {
        return { ok: false, sdkVersion: sdk.sdkVersion, runtimeVersion: 'unknown' }
      }
    },
  })

  server.listen(port, () => log('info', 'copilot-gateway listening', { port, sdkVersion: sdk.sdkVersion }))

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    log('info', 'shutting down', { signal })
    server.close()
    await turns.closeAll()
    await sdk.stop().catch(() => {})
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error) => {
  process.stderr.write(`copilot-gateway failed to start: ${error instanceof Error ? error.message : 'unknown'}\n`)
  process.exit(1)
})
