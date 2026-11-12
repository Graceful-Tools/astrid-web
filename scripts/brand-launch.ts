#!/usr/bin/env npx tsx
/**
 * One command from a brand profile to a smoke-tested deployment (AWTD-1590).
 *
 *   npm run brand:launch -- acme --project acme-tasks --dry-run
 *   npm run brand:launch -- acme --project acme-tasks --team team_xxx --scope acme-co
 *   npm run brand:launch -- acme --docker [--base-url http://localhost:3000] --dry-run
 *
 * Always start with --dry-run: it lists every step and the command or API call behind
 * it, and calls nothing. Without it the steps run in order, each idempotent, and the run
 * stops at the first failure; run the same command again once it is fixed. The steps
 * and the checklist that follows them are in scripts/lib/brand-launch.ts.
 *
 * Needs VERCEL_TOKEN (and NEON_API_KEY for the database step) in .env.local for the
 * Vercel mode. The Vercel team is --team / --scope, then VERCEL_TEAM_ID / VERCEL_SCOPE,
 * then Astrid's (scripts/lib/vercel-target.ts). Never runs `vercel link` or `vercel pull`.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadScriptEnv } from './lib/load-env'
import { parseBrandProfile, profileEnv } from '../lib/brand/profile'
import { resolveVercelTarget, VERCEL_TARGET_FLAGS } from './lib/vercel-target'
import { runBrandLaunch, type LaunchDeps } from './lib/brand-launch'

loadScriptEnv()

const args = process.argv.slice(2)
const valueFlags: string[] = ['--project', '--base-url', ...VERCEL_TARGET_FLAGS]
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const profileArg = args.find((arg, i) => !arg.startsWith('--') && !valueFlags.includes(args[i - 1]))
const mode = args.includes('--docker') ? 'docker' : 'vercel'
const dryRun = args.includes('--dry-run')

if (!profileArg || (mode === 'vercel' && !flag('--project'))) {
  console.error('Usage: npm run brand:launch -- <profile> --project <vercel-project> [--team <id>] [--scope <slug>] [--dry-run]')
  console.error('       npm run brand:launch -- <profile> --docker [--base-url <url>] [--dry-run]')
  process.exit(1)
}

const named = join(process.cwd(), 'brands', `${profileArg}.brand.json`)
const profilePath = existsSync(named) ? named : resolve(profileArg)
if (!existsSync(profilePath)) {
  console.error(`❌ No brand profile at brands/${profileArg}.brand.json or ${profilePath}`)
  process.exit(1)
}

if (mode === 'vercel' && profilePath !== named) {
  // push-brand-env.ts and check:brands both read brands/, so a launch does too.
  console.error(`❌ A Vercel launch reads its profile from brands/: copy it to brands/<name>.brand.json and pass <name>.`)
  process.exit(1)
}

const token = process.env.VERCEL_TOKEN
if (mode === 'vercel' && !dryRun && !token) {
  console.error('❌ VERCEL_TOKEN not set (expected in .env.local)')
  process.exit(1)
}

const deps: LaunchDeps = {
  run(command, commandArgs, env) {
    return new Promise((resolvePromise) => {
      // Output is captured, never echoed: these scripts handle secrets and connection strings.
      const child = spawn(command, commandArgs, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      child.stdout.on('data', (chunk) => { stdout += String(chunk) })
      child.on('close', (status) => resolvePromise({ status: status ?? 1, stdout }))
      child.on('error', () => resolvePromise({ status: 127, stdout: '' }))
    })
  },
  async vercel(method, path, body) {
    const target = resolveVercelTarget(args)
    const sep = path.includes('?') ? '&' : '?'
    const response = await fetch(`https://api.vercel.com${path}${sep}teamId=${target.teamId}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json().catch(() => ({})) }
  },
  fetch: (url) => fetch(url, { redirect: 'follow' }),
  log: (line) => console.log(line),
}

async function main() {
  const profile = parseBrandProfile(JSON.parse(readFileSync(profilePath as string, 'utf8')), profilePath)
  const report = await runBrandLaunch({
    profileName: existsSync(named) ? (profileArg as string) : profilePath,
    env: profileEnv(profile),
    inBrandsDir: profilePath === named,
    mode,
    project: flag('--project'),
    target: resolveVercelTarget(args),
    dryRun,
    baseUrl: flag('--base-url'),
  }, deps)
  process.exit(report.ok ? 0 : 1)
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
