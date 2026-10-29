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

  it('migrates the preview database from main, inside the preview environment', () => {
    const source = read('preview-deployment.yml')
    expect(source).toMatch(/^ {4}environment:\s*preview\s*$/m)
    expect(source).toContain('secrets.PREVIEW_DATABASE_URL_DIRECT')
    expect(source).toMatch(/prisma migrate deploy --schema "\$RUNNER_TEMP\/main\/prisma\/schema\.prisma"/)
  })
})
