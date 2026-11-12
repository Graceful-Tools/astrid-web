/**
 * `npm run brand:launch <profile>`: one command from a brand profile to a smoke-tested
 * deployment (AWTD-1590).
 *
 * A partner used to need about 17 manual steps across four scripts and three consoles.
 * This runs the ones a machine can do, in order, each one idempotent, so a re-run after a
 * failure picks up where it stopped:
 *
 *   Vercel:  check → project (+ framework) → domain → database → environment → web-push
 *            keys → environment again (maps the database's direct URL) → deploy → smoke
 *   Docker:  check → compose up (built with the profile) → smoke
 *
 * and prints what still needs a person (DNS, OAuth clients, the mail sender, the first
 * admin) as a checklist with links.
 *
 * Everything that touches the outside world goes through `LaunchDeps`, so the plan and
 * the steps are tested with mocked commands (tests/scripts/brand-launch-awtd-1590.test.ts),
 * and `--dry-run` describes every step without calling anything.
 *
 * Secrets: generated values go straight to the Vercel API and are never logged. Command
 * output is never echoed; a failing step reports its exit status only.
 */
import { generateVAPIDKeys } from 'web-push'
import type { VercelTarget } from './vercel-target'

export type LaunchMode = 'vercel' | 'docker'

export interface LaunchOptions {
  profileName: string
  /** The profile's resolved environment (profileEnv), already validated. */
  env: Record<string, string>
  /** Whether the profile lives in brands/, which is what `check:brands` reads. */
  inBrandsDir: boolean
  mode: LaunchMode
  /** Vercel project name. Required for the Vercel mode. */
  project?: string
  target: VercelTarget
  dryRun: boolean
  /** Docker mode: where the stack answers. */
  baseUrl?: string
}

export interface CommandResult {
  status: number
  stdout: string
}

export interface LaunchDeps {
  /** Run a command; its output is captured, never printed. */
  run(command: string, args: string[], env?: Record<string, string>): Promise<CommandResult>
  /** Call the Vercel REST API for the target team. Throws on a network error only. */
  vercel(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<{ status: number; body: unknown }>
  fetch(url: string): Promise<{ status: number; text(): Promise<string> }>
  log(line: string): void
}

export type StepOutcome =
  | { status: 'done'; detail?: string }
  | { status: 'skipped'; detail: string }
  | { status: 'failed'; detail: string }

export interface LaunchStep {
  id: string
  title: string
  /** What the step would do, for --dry-run. */
  plan: string
  run(state: LaunchState, deps: LaunchDeps): Promise<StepOutcome>
}

/** What earlier steps learned and later ones need. */
export interface LaunchState {
  projectId?: string
  deploymentUrl?: string
}

function teamFlags(target: VercelTarget): string[] {
  return ['--team', target.teamId, '--scope', target.scope]
}

/** The profile's domain, which a launch cannot do without. */
export function launchDomain(options: LaunchOptions): string {
  const domain = options.env.NEXT_PUBLIC_BRAND_DOMAIN?.trim()
  if (!domain) throw new Error('The profile sets no NEXT_PUBLIC_BRAND_DOMAIN: a deployment of its own needs its own domain.')
  return domain
}

/**
 * Refuse a launch that would act on hosted Astrid. The project and database scripts
 * refuse it too; this stops before anything runs.
 */
export function refuseAstridTarget(options: LaunchOptions): void {
  if (options.mode !== 'vercel') return
  if (!options.project) throw new Error('--project <vercel-project> is required for a Vercel launch.')
  if (options.project === 'astrid-web' || options.project === 'astrid') {
    throw new Error(`Refusing to launch onto "${options.project}": that is hosted Astrid's own project.`)
  }
  if (launchDomain(options) === 'astrid.cc') {
    throw new Error('Refusing to launch a profile whose domain is astrid.cc onto a project of its own.')
  }
}

const checkStep = (options: LaunchOptions): LaunchStep => ({
  id: 'check',
  title: 'Check the profile',
  plan: options.inBrandsDir
    ? 'npm run check:brands (the brand matrix, every profile in brands/ including this one)'
    : 'profile validated; it is outside brands/, so check:brands cannot read it: copy it into brands/ to run the matrix',
  async run(_state, deps) {
    if (!options.inBrandsDir) return { status: 'skipped', detail: 'profile is outside brands/' }
    const result = await deps.run('npm', ['run', 'check:brands'])
    return result.status === 0 ? { status: 'done' } : { status: 'failed', detail: `check:brands exited ${result.status}` }
  },
})

function vercelSteps(options: LaunchOptions): LaunchStep[] {
  const project = options.project as string
  const domain = launchDomain(options)
  const pushEnv = (id: string, title: string, why: string): LaunchStep => ({
    id,
    title,
    plan: `npx tsx scripts/push-brand-env.ts ${options.profileName} --project ${project} ${teamFlags(options.target).join(' ')}  (${why})`,
    async run(_state, deps) {
      const result = await deps.run('npx', ['tsx', 'scripts/push-brand-env.ts', options.profileName, '--project', project, ...teamFlags(options.target)])
      return result.status === 0 ? { status: 'done' } : { status: 'failed', detail: `push-brand-env exited ${result.status}` }
    },
  })

  return [
    {
      id: 'project',
      title: 'Vercel project, framework Next.js',
      plan: `GET /v9/projects/${project}; create it (framework nextjs) if absent, or set the framework if it is not Next.js`,
      async run(state, deps) {
        const found = await deps.vercel('GET', `/v9/projects/${encodeURIComponent(project)}`)
        if (found.status === 200) {
          const body = found.body as { id: string; framework?: string | null }
          state.projectId = body.id
          if (body.framework === 'nextjs') return { status: 'skipped', detail: 'exists, framework Next.js' }
          const patched = await deps.vercel('PATCH', `/v9/projects/${encodeURIComponent(project)}`, { framework: 'nextjs' })
          return patched.status < 300 ? { status: 'done', detail: 'existed; framework set to Next.js' } : { status: 'failed', detail: `setting the framework: HTTP ${patched.status}` }
        }
        if (found.status !== 404) return { status: 'failed', detail: `looking up the project: HTTP ${found.status}` }
        const created = await deps.vercel('POST', '/v11/projects', { name: project, framework: 'nextjs' })
        if (created.status >= 300) return { status: 'failed', detail: `creating the project: HTTP ${created.status}` }
        state.projectId = (created.body as { id: string }).id
        return { status: 'done', detail: 'created' }
      },
    },
    {
      id: 'domain',
      title: `Domain ${domain}`,
      plan: `GET /v9/projects/${project}/domains/${domain}; add it if absent`,
      async run(_state, deps) {
        const path = `/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(domain)}`
        const found = await deps.vercel('GET', path)
        if (found.status === 200) return { status: 'skipped', detail: 'already on the project' }
        const added = await deps.vercel('POST', `/v10/projects/${encodeURIComponent(project)}/domains`, { name: domain })
        return added.status < 300 ? { status: 'done' } : { status: 'failed', detail: `adding the domain: HTTP ${added.status}` }
      },
    },
    {
      id: 'database',
      title: 'Neon database',
      plan: `npx tsx scripts/provision-brand-database.ts --project ${project} ${teamFlags(options.target).join(' ')}  (a re-run is a no-op)`,
      async run(_state, deps) {
        const result = await deps.run('npx', ['tsx', 'scripts/provision-brand-database.ts', '--project', project, ...teamFlags(options.target)])
        return result.status === 0 ? { status: 'done' } : { status: 'failed', detail: `provision-brand-database exited ${result.status}` }
      },
    },
    pushEnv('env', 'Brand environment and generated secrets', 'profile, NEXTAUTH_URL, secrets generated only when absent'),
    {
      id: 'vapid',
      title: 'Web-push keys',
      plan: `generate a VAPID pair and write VAPID_PUBLIC_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (mailto: the profile's support address), only if VAPID_PRIVATE_KEY is absent`,
      async run(_state, deps) {
        const listed = await deps.vercel('GET', `/v9/projects/${encodeURIComponent(project)}/env`)
        if (listed.status !== 200) return { status: 'failed', detail: `listing the environment: HTTP ${listed.status}` }
        const keys = new Set(((listed.body as { envs?: Array<{ key: string }> }).envs ?? []).map(({ key }) => key))
        // Regenerating would orphan every browser already subscribed with the old key.
        if (keys.has('VAPID_PRIVATE_KEY')) return { status: 'skipped', detail: 'already set' }
        const pair = generateVAPIDKeys()
        const support = options.env.NEXT_PUBLIC_BRAND_SUPPORT_EMAIL || `support@${domain}`
        const writes: Array<[string, string, 'plain' | 'encrypted']> = [
          ['VAPID_PUBLIC_KEY', pair.publicKey, 'plain'],
          ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', pair.publicKey, 'plain'],
          ['VAPID_PRIVATE_KEY', pair.privateKey, 'encrypted'],
          ['VAPID_SUBJECT', `mailto:${support}`, 'plain'],
        ]
        for (const [key, value, type] of writes) {
          const written = await deps.vercel('POST', `/v10/projects/${encodeURIComponent(project)}/env?upsert=true`, {
            key, value, type, target: ['production', 'preview'],
          })
          if (written.status >= 300) return { status: 'failed', detail: `writing ${key}: HTTP ${written.status}` }
        }
        return { status: 'done', detail: 'generated (values not shown)' }
      },
    },
    pushEnv('env-again', 'Environment, second pass', 'maps the database direct URL now that it exists'),
    {
      id: 'deploy',
      title: 'Production deployment',
      plan: `VERCEL_ORG_ID=${options.target.teamId} VERCEL_PROJECT_ID=<project id> npx vercel deploy --prod --yes --scope ${options.target.scope}  (no vercel link: the ids target the project; the first build migrates the empty database)`,
      async run(state, deps) {
        if (!state.projectId) return { status: 'failed', detail: 'no project id (the project step did not run)' }
        const result = await deps.run('npx', ['vercel', 'deploy', '--prod', '--yes', '--scope', options.target.scope], {
          VERCEL_ORG_ID: options.target.teamId,
          VERCEL_PROJECT_ID: state.projectId,
        })
        if (result.status !== 0) return { status: 'failed', detail: `vercel deploy exited ${result.status}` }
        state.deploymentUrl = result.stdout.match(/https:\/\/[a-z0-9-]+\.vercel\.app/)?.[0]
        return { status: 'done', detail: state.deploymentUrl ?? 'deployed' }
      },
    },
    smokeStep(options, (state) => state.deploymentUrl ?? `https://${domain}`),
  ]
}

/**
 * What only a running deployment can show about its brand: it is up, and it announces
 * itself as this profile rather than as Astrid. Uses the deployment's own *.vercel.app
 * URL when there is one, so it passes before DNS has propagated.
 */
export function smokeStep(options: LaunchOptions, baseUrl: (state: LaunchState) => string): LaunchStep {
  const name = options.env.NEXT_PUBLIC_BRAND_NAME
  const title = options.env.NEXT_PUBLIC_BRAND_TITLE
  return {
    id: 'smoke',
    title: 'Smoke test',
    plan: `GET /api/health (200), /api/v1/capabilities and /manifest.json (they name ${name ?? 'the brand'})`,
    async run(state, deps) {
      const base = baseUrl(state).replace(/\/$/, '')
      const problems: string[] = []
      const get = async (path: string) => {
        try {
          return await deps.fetch(`${base}${path}`)
        } catch {
          return null
        }
      }
      const health = await get('/api/health')
      if (health?.status !== 200) problems.push(`/api/health: ${health ? `HTTP ${health.status}` : 'unreachable'}`)
      const capabilities = await get('/api/v1/capabilities')
      const capabilitiesText = capabilities?.status === 200 ? await capabilities.text() : ''
      if (name && !capabilitiesText.includes(name)) problems.push(`/api/v1/capabilities does not name ${name}`)
      const manifest = await get('/manifest.json')
      const manifestText = manifest?.status === 200 ? await manifest.text() : ''
      if (title && !manifestText.includes(title)) problems.push(`/manifest.json does not name ${title}`)
      return problems.length === 0
        ? { status: 'done', detail: base }
        : { status: 'failed', detail: `${base}: ${problems.join('; ')}` }
    },
  }
}

function dockerSteps(options: LaunchOptions): LaunchStep[] {
  const compose = ['compose', '-f', 'deploy/self-host/docker-compose.yml']
  const base = options.baseUrl ?? 'http://localhost:3000'
  return [
    {
      id: 'compose',
      title: 'Self-hosted stack (Docker compose)',
      plan: `BRAND=${options.profileName} docker ${compose.join(' ')} up -d --build --wait  (needs deploy/self-host/.env with the required secrets; docs/deployment/SELF_HOSTING.md)`,
      async run(_state, deps) {
        const result = await deps.run('docker', [...compose, 'up', '-d', '--build', '--wait'], { BRAND: options.profileName })
        return result.status === 0 ? { status: 'done' } : { status: 'failed', detail: `docker compose exited ${result.status}` }
      },
    },
    smokeStep(options, () => base),
  ]
}

/** Every step a launch runs, in order. */
export function planBrandLaunch(options: LaunchOptions): LaunchStep[] {
  refuseAstridTarget(options)
  return [checkStep(options), ...(options.mode === 'vercel' ? vercelSteps(options) : dockerSteps(options))]
}

/** What a person still has to do, with where to do it. */
export function manualChecklist(options: LaunchOptions): string[] {
  const domain = options.mode === 'vercel' ? launchDomain(options) : options.env.NEXT_PUBLIC_BRAND_DOMAIN ?? '<your domain>'
  const enabled = (key: string) => options.env[key]?.trim().toLowerCase() !== 'false'
  const items: string[] = []
  if (options.mode === 'vercel') {
    items.push(`DNS: point ${domain} at Vercel (the CNAME or A record shown under the project's Settings → Domains: https://vercel.com/${options.target.scope}/${options.project}/settings/domains)`)
  } else {
    items.push(`DNS and TLS: point ${domain} at the host; the compose file's \`--profile tls\` gets a certificate automatically`)
  }
  if (enabled('NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE')) {
    items.push(`Google sign-in: create an OAuth client with redirect https://${domain}/api/auth/callback/google (https://console.cloud.google.com/apis/credentials), then set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Or turn it off: NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE=false`)
  }
  if (enabled('NEXT_PUBLIC_BRAND_ENABLE_AUTH_APPLE')) {
    items.push(`Sign in with Apple: register a Services ID for ${domain} (https://developer.apple.com/account/resources/identifiers/list/serviceId), then set the Apple client variables. Or turn it off: NEXT_PUBLIC_BRAND_ENABLE_AUTH_APPLE=false`)
  }
  items.push(`Mail: verify ${domain} with your sender and set RESEND_API_KEY (https://resend.com/domains), or EMAIL_TRANSPORT=smtp with an SMTP relay. Without it nothing is sent`)
  items.push('First admin: set INITIAL_ADMIN_EMAIL, sign in with that address once, then remove the variable (docs/WHITELABELING.md §8)')
  items.push('Native apps: build each platform from its own repo against this domain (docs/WHITELABELING.md → Native apps, per platform)')
  return items
}

export interface LaunchReport {
  ok: boolean
  outcomes: Array<{ step: LaunchStep; outcome: StepOutcome | null }>
}

/** Run the plan, stopping at the first failure. --dry-run describes and runs nothing. */
export async function runBrandLaunch(options: LaunchOptions, deps: LaunchDeps): Promise<LaunchReport> {
  const steps = planBrandLaunch(options)
  const state: LaunchState = {}
  const outcomes: LaunchReport['outcomes'] = []
  deps.log(`\nLaunching ${options.profileName} (${options.mode}${options.mode === 'vercel' ? `, project ${options.project}, team ${options.target.scope}` : ''})${options.dryRun ? '  [dry run]' : ''}\n`)

  for (const [index, step] of steps.entries()) {
    const label = `${index + 1}. ${step.title}`
    if (options.dryRun) {
      deps.log(`  ${label}\n       ${step.plan}`)
      outcomes.push({ step, outcome: null })
      continue
    }
    const outcome = await step.run(state, deps)
    outcomes.push({ step, outcome })
    const mark = outcome.status === 'done' ? '✅' : outcome.status === 'skipped' ? '⏭️ ' : '❌'
    deps.log(`  ${mark} ${label}${outcome.detail ? `: ${outcome.detail}` : ''}`)
    if (outcome.status === 'failed') {
      deps.log('\nStopped. Fix the step above and run the same command again: finished steps are skipped.')
      return { ok: false, outcomes }
    }
  }

  deps.log('\nStill to do by hand:')
  for (const item of manualChecklist(options)) deps.log(`  [ ] ${item}`)
  return { ok: true, outcomes }
}
