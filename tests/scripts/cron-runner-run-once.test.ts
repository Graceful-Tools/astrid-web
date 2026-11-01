// @vitest-environment node
/**
 * AWTD-1468: `cron-runner.mjs --run <path>` calls one cron route once and
 * exits, so a scheduler that starts a container per run (Azure Container Apps
 * Jobs, a Kubernetes CronJob) can use the image as it is — it has no curl.
 * The exit code is the job's result: the scheduler shows the run as failed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

const RUNNER = join(process.cwd(), 'scripts/cron-runner.mjs')

let server: Server
let baseUrl = ''
const seen: { path?: string; auth?: string }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ path: req.url, auth: req.headers.authorization })
    if (req.url === '/api/cron/reminders') res.writeHead(200).end('{}')
    else if (req.url === '/api/cron/github-sync') res.writeHead(404).end()
    else res.writeHead(500).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; output: string }>(resolve => {
    const child = spawn(process.execPath, [RUNNER, ...args], {
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', CRON_BASE_URL: baseUrl, CRON_SECRET: 'test-secret', ...env },
    })
    let output = ''
    child.stdout.on('data', chunk => (output += chunk))
    child.stderr.on('data', chunk => (output += chunk))
    child.on('close', code => resolve({ code, output }))
  })
}

describe('cron-runner --run (AWTD-1468)', () => {
  it('calls the route once with the cron secret and exits 0 on success', async () => {
    seen.length = 0
    const { code, output } = await run(['--run', '/api/cron/reminders'])
    expect(code, output).toBe(0)
    expect(seen).toEqual([{ path: '/api/cron/reminders', auth: 'Bearer test-secret' }])
  })

  it('exits 0 on a 404: the route is gated on a capability this brand turned off', async () => {
    const { code, output } = await run(['--run', '/api/cron/github-sync'])
    expect(code, output).toBe(0)
  })

  it('exits non-zero when the route fails, so the scheduler records a failed run', async () => {
    const { code } = await run(['--run', '/api/cron/analytics'])
    expect(code).toBe(1)
  })

  it('refuses a path that is not in vercel.json', async () => {
    seen.length = 0
    const { code, output } = await run(['--run', '/api/cron/not-a-job'])
    expect(code).toBe(2)
    expect(output).toContain('not in')
    expect(seen).toEqual([])
  })
})
