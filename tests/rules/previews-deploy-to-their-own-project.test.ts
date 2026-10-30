/**
 * AWTD-1373: previews deploy to their own Vercel project with a token scoped to
 * it. The repo-level VERCEL_TOKEN can deploy production too, so no preview path
 * may name it, and the preview database is migrated with main's migrations
 * only, so a PR cannot push an unmerged migration into the shared database.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const PREVIEW_PROJECT = 'prj_1sApcqoHQIU6T26XvNlJLYFcnK79'
const read = (file: string) => readFileSync(`.github/workflows/${file}`, 'utf8')

describe('previews deploy to their own project (AWTD-1373)', () => {
  for (const file of ['preview-deployment.yml', 'fixstuff.yml']) {
    it(`${file} uses the preview-scoped token and project`, () => {
      const source = read(file)
      expect(source).not.toMatch(/secrets\.VERCEL_TOKEN\b(?!_)/)
      expect(source).not.toMatch(/secrets\.VERCEL_PROJECT_ID\b/)
      expect(source).toContain('secrets.VERCEL_TOKEN_PREVIEW')
      expect(source).toContain(PREVIEW_PROJECT)
    })
  }

  it('builds on Vercel, where the preview database Secret is readable, opting in to migrate', () => {
    const source = read('preview-deployment.yml')
    // The URL is a Vercel Secret on astrid-web-preview: `vercel pull` redacts
    // it, so a build on the runner cannot migrate and a GitHub copy is not kept.
    expect(source).not.toContain('PREVIEW_DATABASE_URL_DIRECT')
    expect(source).not.toMatch(/vercel deploy[^\n]*--prebuilt/)
    expect(source).toMatch(/--build-env ASTRID_MIGRATE_PREVIEW_DB=1/)
  })

  it('opts in only when the PR changes no migrations', () => {
    const source = read('preview-deployment.yml')
    expect(source).toMatch(/git diff --quiet "\$MERGE_BASE" HEAD -- prisma\/migrations/)
  })

  it('smoke-tests through Vercel Authentication with the automation bypass secret', () => {
    const source = read('preview-deployment.yml')
    const e2e = source.slice(source.indexOf('  e2e-tests:'), source.indexOf('  security-scan:'))
    expect(e2e).toContain('secrets.VERCEL_AUTOMATION_BYPASS_SECRET')
    const curls = e2e.match(/curl [^\n]*/g) ?? []
    expect(curls.length).toBeGreaterThan(0)
    for (const curl of curls) expect(curl).toContain('"${BYPASS[@]}"')
  })
})
