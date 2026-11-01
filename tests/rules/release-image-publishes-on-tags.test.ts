/**
 * AWTD-1464: the self-hosted image is published to GHCR on `v*` tags, and only then.
 *
 * self-host.yml builds and smoke-tests the image but pushes nothing, so a
 * self-hosting partner had nothing to pull. release-image.yml is the one
 * workflow that publishes. These pin what it is allowed to do:
 *
 * - It runs on a `v*` tag, or when dispatched by hand (`:edge`, from main only).
 *   NOT on every push to main — each run builds a Next.js image per brand, and
 *   publishing on push would spend that on every merge. If that is ever wanted,
 *   change the trigger and this test together, on purpose.
 * - Only the publish job can write packages; the top-level token is read-only.
 * - Every image carries an SBOM, and the migrator is published beside the app.
 * - The release is proven by pulling what was pushed and smoke-testing it with
 *   nothing built locally.
 * - The compose file can be pointed at the published pair (IMAGE / IMAGE_TAG).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const workflow = readFileSync(join(ROOT, '.github/workflows/release-image.yml'), 'utf8')
const compose = readFileSync(join(ROOT, 'deploy/self-host/docker-compose.yml'), 'utf8')
const selfHosting = readFileSync(join(ROOT, 'docs/deployment/SELF_HOSTING.md'), 'utf8')

/** The lines of a top-level block (`on:`, `permissions:`, ...), comments dropped. */
function topLevelBlock(source: string, key: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex(line => line.startsWith(`${key}:`))
  expect(start, `no top-level "${key}:"`).toBeGreaterThanOrEqual(0)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^[A-Za-z]/.test(line))
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))]
    .filter(line => !/^\s*#/.test(line))
    .join('\n')
}

describe('release-image.yml (AWTD-1464)', () => {
  const on = topLevelBlock(workflow, 'on')

  it('AWTD-1464 publishes on v* tags and on manual dispatch only', () => {
    expect(on).toMatch(/tags:\s*\[\s*'v\*'\s*\]/)
    expect(on).toMatch(/workflow_dispatch/)
  })

  it('AWTD-1464 does not build images on every push to main, or on pull requests', () => {
    expect(on).not.toMatch(/branches/)
    expect(on).not.toMatch(/pull_request/)
    expect(on).not.toMatch(/schedule/)
  })

  it('AWTD-1464 refuses to publish :edge from anything but main', () => {
    expect(workflow).toMatch(/"\$REF_NAME" = main/)
    expect(workflow).toMatch(/version=edge/)
  })

  it('AWTD-1464 keeps the default token read-only and grants packages: write to the publish job alone', () => {
    expect(topLevelBlock(workflow, 'permissions').trim()).toMatch(/^permissions:\n\s+contents: read$/)
    expect(workflow.match(/packages: write/g)).toHaveLength(1)
    const publish = workflow.slice(workflow.indexOf('  publish:'), workflow.indexOf('  smoke:'))
    expect(publish).toMatch(/packages: write/)
  })

  it('AWTD-1464 pushes the app and the migrator to GHCR, each with an SBOM', () => {
    expect(workflow).toMatch(/IMAGE: ghcr\.io\/graceful-tools\/astrid-web/)
    expect(workflow).toMatch(/target: migrator/)
    expect(workflow).toMatch(/-migrator"/)
    expect(workflow.match(/sbom: true/g)).toHaveLength(2)
  })

  it('AWTD-1464 pins every third-party action to a commit', () => {
    const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map(m => m[1])
    expect(uses.length).toBeGreaterThan(3)
    for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/)
  })

  it('AWTD-1464 smoke-tests the pulled image without building anything', () => {
    const smoke = workflow.slice(workflow.indexOf('  smoke:'))
    expect(smoke).toMatch(/needs: publish/)
    expect(smoke).toMatch(/pull migrate app/)
    expect(smoke).toMatch(/up -d --no-build/)
    expect(smoke).not.toMatch(/--build\b(?!-)/)
    expect(smoke).toMatch(/self-host-smoke\.ts/)
  })
})

describe('the compose stack can run a published tag (AWTD-1464)', () => {
  it('AWTD-1464 names the migrator image from IMAGE / IMAGE_TAG, so it can be pulled', () => {
    const migrate = compose.slice(compose.indexOf('  migrate:'), compose.indexOf('  app:'))
    expect(migrate).toMatch(/image: \$\{IMAGE:-tasks-selfhost\}:\$\{IMAGE_TAG:-latest\}-migrator/)
  })

  it('AWTD-1464 documents the upgrade path: pull the tag, migrate, then roll the app', () => {
    expect(selfHosting).toMatch(/ghcr\.io\/graceful-tools\/astrid-web/)
    expect(selfHosting).toMatch(/forward-only/i)
  })
})
