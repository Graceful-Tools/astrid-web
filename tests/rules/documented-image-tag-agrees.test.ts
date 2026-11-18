/**
 * ADEV-98: every place that names a published image tag names the same one.
 *
 * SELF_HOSTING.md said 1.4.0, .env.example 1.0.0 and the Azure bicepparam
 * 1.0.0-whitelabel-partner, and GHCR had only 1.3.0, so a partner following any
 * of them pulled nothing or a build with no runtime-brand support. Bumping the
 * release means changing all three together; this fails until they agree.
 * (That the tag exists on GHCR is proven by release-image.yml publishing it.)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const selfHosting = /^IMAGE_TAG=(\S+)$/m.exec(read('docs/deployment/SELF_HOSTING.md'))?.[1]
const envExample = /^# IMAGE_TAG=(\S+)$/m.exec(read('deploy/self-host/.env.example'))?.[1]
const bicep = read('deploy/azure/whitelabel-partner.bicepparam')
const appLine = bicep.split('\n').find(l => l.startsWith('param appImage')) ?? ''
const migratorLine = bicep.split('\n').find(l => l.startsWith('param migratorImage')) ?? ''
const app = /astrid-web:([^']+)'\)\s*$/.exec(appLine)?.[1]
const migrator = /astrid-web:([^']+)-migrator'/.exec(migratorLine)?.[1]

describe('ADEV-98 documented image tag', () => {
  it('is one plain version in every doc and the bicepparam default', () => {
    expect(selfHosting).toMatch(/^\d+\.\d+\.\d+$/)
    expect(envExample).toBe(selfHosting)
    expect(app).toBe(selfHosting)
    expect(migrator).toBe(selfHosting)
  })
})
