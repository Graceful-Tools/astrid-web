/**
 * Smoke-test a running self-hosted stack (AWTD-1286).
 *
 *   SMOKE_BASE_URL=http://localhost:3000 NEXTAUTH_SECRET=… CRON_SECRET=… npx tsx scripts/self-host-smoke.ts
 *
 * NEXTAUTH_SECRET and CRON_SECRET must be the stack's own. The CI job
 * (.github/workflows/self-host.yml) runs this against `docker compose up`; an
 * operator can run it against their deployment after an upgrade.
 *
 * Checks what only a real deployment can show: the image boots and migrates,
 * pages and the API answer, cron routes accept the secret and refuse without
 * it, and an upload lands in storage and is served back — the path the
 * Vercel-only build had no way to take. With SMOKE_SMTP_URL and
 * SMOKE_MAILPIT_URL (the compose's `--profile mail` sink), one email goes
 * through the SMTP transport and is read back.
 */

import { randomUUID } from 'node:crypto'
import { createUploadToken } from '../lib/storage/upload-token'

const base = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const failures: string[] = []

async function check(name: string, run: () => Promise<string | void>) {
  try {
    const detail = await run()
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    failures.push(name)
    console.log(`❌ ${name} — ${error instanceof Error ? error.message : String(error)}`)
  }
}

function expectStatus(response: Response, ...statuses: number[]) {
  if (!statuses.includes(response.status)) throw new Error(`HTTP ${response.status}`)
}

async function main() {
  await check('health', async () => {
    const response = await fetch(`${base}/api/health`)
    expectStatus(response, 200)
    const body = await response.json()
    if (body.status !== 'healthy') throw new Error(`status ${body.status}`)
    return `commit ${body.commitSha}`
  })

  await check('capabilities', async () => {
    const response = await fetch(`${base}/api/v1/capabilities`)
    expectStatus(response, 200)
    const body = await response.json()
    return `brand ${body.brand?.appName}, sign-in ${JSON.stringify(body.auth?.providers?.map((p: { id: string }) => p.id) ?? body.auth)}`
  })

  await check('sign-in page renders', async () => {
    const response = await fetch(`${base}/auth/signin`, { redirect: 'manual' })
    expectStatus(response, 200, 307, 308)
  })

  await check('cron routes fail closed without the secret', async () => {
    expectStatus(await fetch(`${base}/api/cron/abandoned-uploads`), 401)
  })

  await check('cron routes accept the secret', async () => {
    const secret = process.env.CRON_SECRET
    if (!secret) throw new Error('CRON_SECRET is not set for the smoke test')
    const response = await fetch(`${base}/api/cron/abandoned-uploads`, { headers: { authorization: `Bearer ${secret}` } })
    expectStatus(response, 200)
  })

  await check('direct upload lands and is served back', async () => {
    const pathname = `uploads/smoke/${randomUUID()}.txt`
    const content = `self-host smoke ${new Date().toISOString()}`
    const token = createUploadToken({ pathname, allowedContentTypes: ['text/plain'], maximumSizeInBytes: 1024 })
    const put = await fetch(`${base}/api/v1/storage/uploads/${token}`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: content,
    })
    expectStatus(put, 200)
    const { url } = (await put.json()) as { url: string }
    // The stored URL uses the public origin; read it back through the one we can reach.
    const served = await fetch(`${base}${new URL(url).pathname}`)
    expectStatus(served, 200)
    if ((await served.text()) !== content) throw new Error('served bytes differ from uploaded bytes')
    const ranged = await fetch(`${base}${new URL(url).pathname}`, { headers: { range: 'bytes=0-3' } })
    expectStatus(ranged, 206)
    return url
  })

  // With the compose's mail sink up (--profile mail), one email through the SMTP
  // transport, read back from the sink (AWTD-1466). SMOKE_SMTP_URL is the sink as
  // this machine reaches it, which is not the in-stack smtp://mailpit:1025.
  const smtpUrl = process.env.SMOKE_SMTP_URL
  const mailpitUrl = process.env.SMOKE_MAILPIT_URL?.replace(/\/+$/, '')
  if (smtpUrl && mailpitUrl) {
    await check('an email sent over SMTP reaches the sink', async () => {
      process.env.EMAIL_TRANSPORT = 'smtp'
      process.env.SMTP_URL = smtpUrl
      const { sendTransportEmail } = await import('../lib/email-transport')
      const subject = `self-host smoke ${randomUUID()}`
      await sendTransportEmail({
        from: 'smoke@example.com',
        to: 'operator@example.com',
        subject,
        html: `<p>${subject}</p>`,
        text: subject,
      })
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await fetch(`${mailpitUrl}/api/v1/messages`)
        expectStatus(response, 200)
        const { messages } = (await response.json()) as { messages: Array<{ ID: string; Subject: string }> }
        const found = messages.find(m => m.Subject === subject)
        if (found) {
          const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${found.ID}`)).json()) as { Text: string }
          if (message.Text.trim() !== subject) throw new Error('the sink received a different body')
          return found.ID
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      throw new Error('the sink never received it')
    })
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('\nSelf-hosted stack is serving.')
}

void main()
