/**
 * AWTD-1066: a partner deployment gets a Neon database of its own.
 *
 * scripts/provision-brand-database.ts creates (or reuses) a Neon project and
 * writes its URLs to the partner's Vercel project. The decisions that must never
 * go wrong live here: it must refuse Astrid's own project, it must not create a
 * second database on a re-run, and it must not swap the pooled and direct URLs —
 * migrations through a pooler fail, and runtime traffic on the direct host
 * exhausts connections.
 */
import { describe, it, expect } from 'vitest'

import {
  ASTRID_VERCEL_PROJECT_ID,
  assertPartnerProject,
  findNeonProject,
  isPooledUri,
  databaseEnvRows,
} from '../../scripts/lib/brand-database'

const pooled = 'postgresql://owner:pw@ep-cool-name-123-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require'
const direct = 'postgresql://owner:pw@ep-cool-name-123.us-west-2.aws.neon.tech/neondb?sslmode=require'

describe('assertPartnerProject (AWTD-1066)', () => {
  it("refuses Astrid's production Vercel project by id or name", () => {
    expect(() => assertPartnerProject({ id: ASTRID_VERCEL_PROJECT_ID, name: 'renamed' })).toThrow(/Astrid/)
    expect(() => assertPartnerProject({ id: 'prj_other', name: 'astrid-web' })).toThrow(/Astrid/)
  })

  it('accepts a partner project', () => {
    expect(() => assertPartnerProject({ id: 'prj_IgjrGLDnt54Y0VN0h6unKlXdXiWL', name: 'whitelabel-partner' })).not.toThrow()
  })
})

describe('findNeonProject (AWTD-1066)', () => {
  const projects = [
    { id: 'morning-fog', name: 'astrid -resurrection' },
    { id: 'blue-sky', name: 'whitelabel-partner' },
  ]

  it('reuses a project with exactly the same name, so a re-run creates nothing', () => {
    expect(findNeonProject(projects, 'whitelabel-partner')?.id).toBe('blue-sky')
  })

  it('never matches on a prefix or substring', () => {
    expect(findNeonProject(projects, 'astrid')).toBeUndefined()
    expect(findNeonProject(projects, 'whitelabel')).toBeUndefined()
  })
})

describe('pooled vs direct (AWTD-1066)', () => {
  it('recognises the pooler host', () => {
    expect(isPooledUri(pooled)).toBe(true)
    expect(isPooledUri(direct)).toBe(false)
  })

  it('maps pooled to DATABASE_URL and direct to DATABASE_URL_DIRECT, for production and preview', () => {
    expect(databaseEnvRows({ pooled, direct })).toEqual([
      { key: 'DATABASE_URL', value: pooled, type: 'encrypted', target: ['production', 'preview'] },
      { key: 'DATABASE_URL_DIRECT', value: direct, type: 'encrypted', target: ['production', 'preview'] },
    ])
  })

  it('refuses URLs that arrive swapped', () => {
    expect(() => databaseEnvRows({ pooled: direct, direct: pooled })).toThrow(/pooled/)
  })
})
