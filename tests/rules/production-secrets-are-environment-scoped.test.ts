/**
 * Production database credentials live in the `production` GitHub Environment,
 * and only the deploy workflow's migration job may name them.
 *
 * Until 2026-10-24 `DATABASE_URL` and `DATABASE_URL_DIRECT` were repo-level
 * secrets, which every workflow in the repo can read — including the agent
 * workflows (fixall, fixstuff, the Copilot coding agent) that run code an agent
 * just wrote. `preview-deployment.yml` went further: `DATABASE_URL_PREVIEW` was
 * never set, so its `|| secrets.DATABASE_URL` fallback handed the production URL
 * to the build of every same-repo PR branch.
 *
 * Agents may write code, open PRs and dispatch the deploy; they never hold the
 * keys (docs/CLI_OPERATIONS.md §0). Environment secrets are only released to a job that
 * declares the environment, and the environment only admits `main`. Builds don't
 * connect to the database, so they get a placeholder URL, as e2e-tests.yml does.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const WORKFLOWS = '.github/workflows'
const PROD_SECRETS = /secrets\.(DATABASE_URL|DATABASE_URL_DIRECT)\b/
const ALLOWED = new Set(['production-deployment.yml:database-migration'])

/** Top-level jobs of a workflow, keyed by id, as raw text. */
function jobsOf(source: string): Map<string, string> {
  const lines = source.split('\n')
  const start = lines.findIndex(line => /^jobs:\s*$/.test(line))
  const jobs = new Map<string, string>()
  if (start === -1) return jobs
  let id: string | null = null
  let body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z]/.test(line)) break
    const header = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/)
    if (header) {
      if (id) jobs.set(id, body.join('\n'))
      id = header[1]
      body = []
    } else if (id) {
      body.push(line)
    }
  }
  if (id) jobs.set(id, body.join('\n'))
  return jobs
}

const workflows = readdirSync(WORKFLOWS).filter(f => /\.ya?ml$/.test(f))

describe('production secrets are environment-scoped', () => {
  it('only the deploy migration job names the production database secrets', () => {
    const offenders: string[] = []
    for (const file of workflows) {
      for (const [id, body] of jobsOf(readFileSync(join(WORKFLOWS, file), 'utf8'))) {
        if (PROD_SECRETS.test(body) && !ALLOWED.has(`${file}:${id}`)) offenders.push(`${file}:${id}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the jobs that touch production declare the production environment', () => {
    const jobs = jobsOf(readFileSync(join(WORKFLOWS, 'production-deployment.yml'), 'utf8'))
    for (const id of ['database-migration', 'deploy-production']) {
      expect(jobs.get(id), `production-deployment.yml has no ${id} job`).toBeDefined()
      expect(jobs.get(id), `${id} must declare environment: production`).toMatch(/^ {4}environment:\s*production\s*$/m)
    }
  })

  it('no workflow falls back to a production secret', () => {
    for (const file of workflows) {
      const source = readFileSync(join(WORKFLOWS, file), 'utf8')
      expect(source, `${file} falls back to a production secret`).not.toMatch(/\|\|\s*secrets\.DATABASE_URL(_DIRECT)?\b/)
    }
  })
})
