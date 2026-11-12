/**
 * AWTD-1590 — `npm run brand:launch <profile>`.
 *
 * Every command and API call is mocked: these tests never provision anything. They pin
 * the order of the steps, that each is idempotent (a re-run skips what exists), that the
 * run stops at the first failure, that --dry-run calls nothing, that generated secrets
 * never reach the log, and that hosted Astrid cannot be the target.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBrandProfile, profileEnv } from '@/lib/brand/profile'
import { BRAND } from '@/lib/brand/config'
import { runBrandLaunch, planBrandLaunch, manualChecklist, type LaunchDeps, type LaunchOptions } from '@/scripts/lib/brand-launch'

const acmeEnv = profileEnv(parseBrandProfile(JSON.parse(readFileSync(join(process.cwd(), 'brands/acme.brand.json'), 'utf8'))))
const TARGET = { teamId: 'team_partner', scope: 'partner-co', isAstridTeam: false }

function options(overrides: Partial<LaunchOptions> = {}): LaunchOptions {
  return { profileName: 'acme', env: acmeEnv, inBrandsDir: true, mode: 'vercel', project: 'acme-tasks', target: TARGET, dryRun: false, ...overrides }
}

/** A fake Vercel + shell + network, recording every call. */
function fakeDeps(world: { projectExists?: boolean; framework?: string; domainExists?: boolean; envKeys?: string[]; failCommand?: string } = {}) {
  const calls: string[] = []
  const logs: string[] = []
  const deps: LaunchDeps = {
    run: vi.fn(async (command: string, args: string[], env?: Record<string, string>) => {
      const line = `${env ? Object.entries(env).map(([k, v]) => `${k}=${v} `).join('') : ''}${command} ${args.join(' ')}`
      calls.push(`run ${line}`)
      if (world.failCommand && line.includes(world.failCommand)) return { status: 2, stdout: '' }
      if (args.includes('deploy')) return { status: 0, stdout: 'Production: https://acme-tasks-abc123-partner-co.vercel.app [40s]' }
      return { status: 0, stdout: '' }
    }),
    vercel: vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push(`${method} ${path}${body && typeof body === 'object' && 'key' in body ? ` ${(body as { key: string }).key}` : ''}`)
      if (method === 'GET' && path === '/v9/projects/acme-tasks') {
        return world.projectExists ? { status: 200, body: { id: 'prj_1', framework: world.framework ?? 'nextjs' } } : { status: 404, body: {} }
      }
      if (method === 'POST' && path === '/v11/projects') return { status: 200, body: { id: 'prj_new' } }
      if (method === 'GET' && path.includes('/domains/')) return { status: world.domainExists ? 200 : 404, body: {} }
      if (method === 'GET' && path.endsWith('/env')) return { status: 200, body: { envs: (world.envKeys ?? []).map((key) => ({ key })) } }
      return { status: 200, body: {} }
    }),
    fetch: vi.fn(async (url: string) => ({
      status: 200,
      text: async () => (url.endsWith('/manifest.json') ? '{"name":"Acme Tasks"}' : '{"brand":{"name":"Acme"}}'),
    })),
    log: (line: string) => { logs.push(line) },
  }
  return { deps, calls, logs }
}

describe('brand:launch (AWTD-1590)', () => {
  it('runs every automatable step in order on a fresh partner, and ends green', async () => {
    const { deps, calls, logs } = fakeDeps()
    const report = await runBrandLaunch(options(), deps)

    expect(report.ok).toBe(true)
    expect(report.outcomes.map(({ step }) => step.id)).toEqual(
      ['check', 'project', 'domain', 'database', 'env', 'vapid', 'env-again', 'deploy', 'smoke'],
    )
    expect(calls).toContain('POST /v11/projects')
    expect(calls).toContain('POST /v10/projects/acme-tasks/domains')
    expect(calls).toContain('run npx tsx scripts/provision-brand-database.ts --project acme-tasks --team team_partner --scope partner-co')
    expect(calls.filter((c) => c.includes('push-brand-env.ts acme --project acme-tasks'))).toHaveLength(2)
    // Targets the new project by id, with no `vercel link`.
    expect(calls).toContain('run VERCEL_ORG_ID=team_partner VERCEL_PROJECT_ID=prj_new npx vercel deploy --prod --yes --scope partner-co')
    expect(calls.some((c) => / link| pull|env pull/.test(c))).toBe(false)
    // The smoke test uses the deployment's own URL, so it passes before DNS propagates.
    expect(deps.fetch).toHaveBeenCalledWith('https://acme-tasks-abc123-partner-co.vercel.app/api/health')
    // And the human part is a checklist, not silence.
    expect(logs.join('\n')).toMatch(/DNS: point tasks\.acme\.example/)
    expect(logs.join('\n')).toMatch(/INITIAL_ADMIN_EMAIL/)
  })

  it('is idempotent: an existing project, domain and push keys are left alone', async () => {
    const { deps, calls } = fakeDeps({ projectExists: true, domainExists: true, envKeys: ['VAPID_PRIVATE_KEY'] })
    const report = await runBrandLaunch(options(), deps)

    expect(report.ok).toBe(true)
    const outcome = (id: string) => report.outcomes.find(({ step }) => step.id === id)?.outcome?.status
    expect(outcome('project')).toBe('skipped')
    expect(outcome('domain')).toBe('skipped')
    expect(outcome('vapid')).toBe('skipped')
    expect(calls.some((c) => c.startsWith('POST /v11/projects') || c.startsWith('POST /v10/projects/acme-tasks/domains'))).toBe(false)
    expect(calls.some((c) => c.includes('VAPID'))).toBe(false)
  })

  it('sets the framework on an existing project that is not Next.js', async () => {
    const { deps, calls } = fakeDeps({ projectExists: true, framework: 'other' })
    await runBrandLaunch(options(), deps)
    expect(calls).toContain('PATCH /v9/projects/acme-tasks')
  })

  it('writes web-push keys without ever logging them', async () => {
    const { deps, calls, logs } = fakeDeps()
    await runBrandLaunch(options(), deps)
    const writes = (deps.vercel as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , body]) => body && typeof body === 'object' && 'key' in body)
      .map(([, , body]) => body as { key: string; value: string; type: string })
    expect(writes.map(({ key }) => key)).toEqual(['VAPID_PUBLIC_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'])
    const secret = writes.find(({ key }) => key === 'VAPID_PRIVATE_KEY')!
    expect(secret.type).toBe('encrypted')
    expect(secret.value.length).toBeGreaterThan(20)
    expect(logs.join('\n')).not.toContain(secret.value)
    expect(calls.join('\n')).not.toContain(secret.value)
  })

  it('stops at the first failing step and says how to resume', async () => {
    const { deps, calls, logs } = fakeDeps({ failCommand: 'provision-brand-database' })
    const report = await runBrandLaunch(options(), deps)

    expect(report.ok).toBe(false)
    expect(report.outcomes.at(-1)?.step.id).toBe('database')
    expect(calls.some((c) => c.includes('push-brand-env') || c.includes('vercel deploy'))).toBe(false)
    expect(logs.join('\n')).toMatch(/run the same command again/)
  })

  it('fails the smoke test when the deployment still says Astrid', async () => {
    const { deps } = fakeDeps()
    deps.fetch = vi.fn(async () => ({ status: 200, text: async () => '{"brand":{"name":"Astrid"}}' }))
    const report = await runBrandLaunch(options(), deps)
    expect(report.ok).toBe(false)
    expect(report.outcomes.at(-1)?.outcome).toMatchObject({ status: 'failed', detail: expect.stringContaining('does not name Acme') })
  })

  it('--dry-run describes every step and calls nothing', async () => {
    const { deps, logs } = fakeDeps()
    const report = await runBrandLaunch(options({ dryRun: true }), deps)

    expect(report.ok).toBe(true)
    expect(deps.run).not.toHaveBeenCalled()
    expect(deps.vercel).not.toHaveBeenCalled()
    expect(deps.fetch).not.toHaveBeenCalled()
    expect(logs.join('\n')).toMatch(/\[dry run\]/)
    expect(logs.join('\n')).toMatch(/vercel deploy --prod/)
  })

  it('refuses hosted Astrid as the target', () => {
    expect(() => planBrandLaunch(options({ project: 'astrid-web' }))).toThrow(/hosted Astrid/)
    expect(() => planBrandLaunch(options({ env: { ...acmeEnv, NEXT_PUBLIC_BRAND_DOMAIN: BRAND.domain } }))).toThrow(/hosted Astrid|onto a project of its own/)
    expect(() => planBrandLaunch(options({ project: undefined }))).toThrow(/--project/)
  })

  it('offers the same command for the Docker self-host path', async () => {
    const { deps, calls } = fakeDeps()
    const report = await runBrandLaunch(options({ mode: 'docker', project: undefined, baseUrl: 'http://localhost:3000' }), deps)
    expect(report.ok).toBe(true)
    expect(report.outcomes.map(({ step }) => step.id)).toEqual(['check', 'compose', 'smoke'])
    expect(calls).toContain('run BRAND=acme docker compose -f deploy/self-host/docker-compose.yml up -d --build --wait')
    expect(deps.vercel).not.toHaveBeenCalled()
  })

  it('lists only the OAuth providers the profile keeps on', () => {
    // Acme is passkey-only, so it has no Google or Apple client to register.
    expect(manualChecklist(options()).join('\n')).not.toMatch(/Google sign-in|Sign in with Apple/)
    const withGoogle = manualChecklist(options({ env: { ...acmeEnv, NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE: 'true' } }))
    expect(withGoogle.join('\n')).toMatch(/https:\/\/tasks\.acme\.example\/api\/auth\/callback\/google/)
  })
})
