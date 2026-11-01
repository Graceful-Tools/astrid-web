// @vitest-environment node
/**
 * RULE — AWTD-1463: a change to a seam runs the self-hosted smoke test.
 *
 * Unit tests prove a driver against its contract; only .github/workflows/self-host.yml
 * proves the image boots, migrates and stores an upload with the backend chosen
 * by env (PLATFORM_ASSESSMENT_2026-11 §5). It is path-filtered, so a seam left out
 * of its filter is a seam whose changes reach a partner's deployment unsmoked.
 *
 * lib/realtime/ and lib/jobs/ (and scripts/job-worker.mjs) are listed before
 * they exist on purpose: the filter is the promise they are smoke-tested from
 * their first PR.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, matchesGlob } from 'node:path'
import { createRequire } from 'node:module'

// js-yaml ships no types; the other rule tests load it the same way.
const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load(source: string): unknown }

const workflow = yaml.load(readFileSync(join(process.cwd(), '.github/workflows/self-host.yml'), 'utf8')) as {
  on: { pull_request: { paths: string[] } }
}
const paths = workflow.on.pull_request.paths

/** Would a PR changing only `file` trigger the workflow? */
const triggers = (file: string) => paths.some(glob => matchesGlob(file, glob))

describe('self-host.yml runs on every seam (AWTD-1463)', () => {
  it.each([
    'lib/storage/object-store.ts',
    'lib/storage/azure-blob-object-store.ts',
    'lib/realtime/bus.ts',
    'lib/email-transport.ts',
    'lib/jobs/drain.ts',
    'Dockerfile',
    'deploy/self-host/docker-compose.yml',
    'deploy/azure/main.bicep',
    'scripts/cron-runner.mjs',
    'scripts/job-worker.mjs',
  ])('a PR touching only %s runs the smoke', file => {
    expect(triggers(file), `${file} is not in self-host.yml's pull_request.paths`).toBe(true)
  })

  it('is still path-filtered, so the list above means something', () => {
    expect(triggers('components/ui/button.tsx')).toBe(false)
  })
})
