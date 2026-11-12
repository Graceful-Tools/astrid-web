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
 *
 * With SMOKE_BRAND_PROFILE (a brand profile on this machine, the one the stack was
 * started with), the brand is checked too (AWTD-1606): pages carry the profile's name
 * and none of its `forbidLiterals`, the manifest is the brand's, and every icon loads
 * and is not Astrid's. With SMOKE_BRAND_ASSETS_DIR (the directory mounted as the
 * container's BRAND_ASSETS_DIR), artwork under /brand-assets/ must be those files.
 *
 * Pages are followed redirect by redirect, so a redirect loop is a failure with the
 * hops named, not a fetch that gives up.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createUploadToken } from '../lib/storage/upload-token'
import { astridFileForGenerated, parseGeneratedIconFile } from '../lib/brand/icons'

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

const MAX_HOPS = 5

/**
 * GET a page, following redirects one at a time. A repeated location or more than
 * MAX_HOPS fails with the chain, which is what a 307 loop looks like (AWTD-1606).
 */
async function getPage(path: string): Promise<{ response: Response; html: string; hops: string[] }> {
  let url = new URL(path, base)
  // Whole URLs, so a same-path redirect to another host (apex to www) is not a loop.
  const seen = [url.href]
  const hops = [path]
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const response = await fetch(url, { redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      return { response, html: await response.text(), hops }
    }
    url = new URL(location, url)
    const next = url.origin === new URL(base).origin ? `${url.pathname}${url.search}` : url.href
    if (seen.includes(url.href)) throw new Error(`redirect loop: ${[...hops, next].join(' → ')} (HTTP ${response.status})`)
    seen.push(url.href)
    hops.push(next)
  }
  throw new Error(`more than ${MAX_HOPS} redirects: ${hops.join(' → ')}`)
}

/** The forbidden literals a page contains, each with a little context. */
function forbiddenIn(text: string, literals: string[]): string[] {
  return literals.flatMap((literal) => {
    const at = text.indexOf(literal)
    return at === -1 ? [] : [`"${literal}" in …${text.slice(Math.max(0, at - 40), at + literal.length + 40)}…`]
  })
}

interface SmokeBrandProfile {
  expect: {
    appName: string
    productTitle: string
    accentColor: string
    requireLiterals: string[]
    forbidLiterals: string[]
    logo: string
    icon: string
  }
}

async function checkBrand(profilePath: string, assetsDir: string | undefined) {
  const { expect: brand } = JSON.parse(readFileSync(profilePath, 'utf8')) as SmokeBrandProfile

  await check(`capabilities report ${brand.appName}`, async () => {
    const body = await (await fetch(`${base}/api/v1/capabilities`)).json()
    if (body.brand?.appName !== brand.appName) throw new Error(`brand ${body.brand?.appName}`)
  })

  // Default-locale paths, and one prefixed locale: the brand is per request, not per build.
  for (const path of ['/auth/signin', '/terms', '/privacy', '/help', '/es/terms']) {
    await check(`${path} is ${brand.appName}'s`, async () => {
      const { response, html, hops } = await getPage(path)
      expectStatus(response, 200)
      const title = html.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] ?? ''
      if (!title.includes(brand.appName)) throw new Error(`title "${title}"`)
      const missing = brand.requireLiterals.filter((literal) => !html.includes(literal))
      if (missing.length > 0) throw new Error(`missing ${missing.join(', ')}`)
      const forbidden = forbiddenIn(html, brand.forbidLiterals)
      if (forbidden.length > 0) throw new Error(forbidden.join('; '))
      return `${title}${hops.length > 1 ? ` via ${hops.join(' → ')}` : ''}`
    })
  }

  // The rendered <img>, not the brand script (which carries the logo path on every page
  // of a runtime-brand image whether or not anything displays it). next/image points at
  // the optimizer, so the path is URL-encoded inside src/srcset; the image it names must
  // then load.
  await check(`the sign-in page shows ${brand.appName}'s logo`, async () => {
    const { html } = await getPage('/auth/signin')
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0])
    const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))?.[1]?.replace(/&amp;/g, '&')
    const logo = imgs.find((tag) =>
      [attr(tag, 'src'), attr(tag, 'srcset')].some((value) => value && decodeURIComponent(value).includes(brand.logo)))
    if (!logo) throw new Error(`no <img> on the page shows ${brand.logo}`)
    const src = attr(logo, 'src') as string
    const image = await fetch(new URL(src, base))
    expectStatus(image, 200)
    if (!image.headers.get('content-type')?.startsWith('image/')) throw new Error(`${src} is ${image.headers.get('content-type')}`)
    return src
  })

  await check(`manifest and icons are ${brand.appName}'s`, async () => {
    const response = await fetch(`${base}/manifest.json`)
    expectStatus(response, 200)
    const manifest = (await response.json()) as { name: string; short_name: string; theme_color: string; icons: Array<{ src: string }> }
    if (manifest.name !== brand.productTitle) throw new Error(`name "${manifest.name}"`)
    if (manifest.short_name !== brand.appName) throw new Error(`short_name "${manifest.short_name}"`)
    if (manifest.theme_color !== brand.accentColor) throw new Error(`theme_color ${manifest.theme_color}`)
    const sources = [...new Set(manifest.icons.map((icon) => icon.src))]
    for (const src of sources) {
      const icon = await fetch(`${base}${src}`)
      expectStatus(icon, 200)
      if (icon.headers.get('content-type') !== 'image/png') throw new Error(`${src} is ${icon.headers.get('content-type')}`)
      const generated = parseGeneratedIconFile(basename(src))
      if (!src.startsWith('/brand-icon/') || !generated) throw new Error(`${src} is not generated from the brand icon`)
      const astrid = readFileSync(join(process.cwd(), 'public', astridFileForGenerated(generated)))
      if (Buffer.from(await icon.arrayBuffer()).equals(astrid)) throw new Error(`${src} is Astrid's icon`)
    }
    return `${manifest.name}, ${sources.length} icons`
  })

  if (assetsDir) {
    for (const asset of [brand.icon, brand.logo].filter((path) => path.startsWith('/brand-assets/'))) {
      await check(`${asset} is the mounted file`, async () => {
        const response = await fetch(`${base}${asset}`)
        expectStatus(response, 200)
        const mounted = readFileSync(join(assetsDir, asset.slice('/brand-assets/'.length)))
        if (!Buffer.from(await response.arrayBuffer()).equals(mounted)) throw new Error('served bytes differ from the mounted file')
      })
    }
  }
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
    const { response } = await getPage('/auth/signin')
    expectStatus(response, 200)
  })

  // A local standalone `next start` reached as localhost was seen to 307-loop on these
  // (AWTD-1606). The container does not: in CI /terms is a 200 and /en/terms is one 307
  // to /terms (next-intl's `as-needed` prefix). getPage fails on a loop, naming the hops,
  // so a regression in the image shows up here.
  for (const path of ['/terms', '/en/terms']) {
    await check(`${path} settles without a redirect loop`, async () => {
      const { response, hops } = await getPage(path)
      expectStatus(response, 200)
      return hops.join(' → ')
    })
  }

  const brandProfile = process.env.SMOKE_BRAND_PROFILE?.trim()
  if (brandProfile) await checkBrand(brandProfile, process.env.SMOKE_BRAND_ASSETS_DIR?.trim() || undefined)

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
