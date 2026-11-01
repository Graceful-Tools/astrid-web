// @vitest-environment node
/**
 * RULE — AWTD-1468: deploy/azure sets only variables the app actually reads.
 *
 * The Bicep template and each brand's parameters file name environment
 * variables as object keys (`NEXTAUTH_URL: publicUrl`, `FROM_EMAIL: '…'`).
 * A misspelt or renamed key is not an error anywhere: Container Apps happily
 * injects `AZURE_STORAGE_CONTAINR`, the app never reads it, and the boot
 * refuses (or worse, silently falls back to a default). lib/env.ts is the
 * registry of what the app reads (scripts/check-env-schema.ts keeps it honest
 * against source), so every key here must be in it.
 *
 * Also pinned, because each is a way the template can drift from the repo:
 *   - every `required` variable is supplied by the template itself;
 *   - the cron Jobs come from vercel.json, not a copy of it;
 *   - every generated Container Apps Job name fits Azure's 32-character limit;
 *   - the worker stays off by default until scripts/job-worker.mjs exists in
 *     the image (AWTD-1460).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ENV_BY_NAME, requiredVars } from '@/lib/env'

const ROOT = process.cwd()
const DIR = join(ROOT, 'deploy/azure')
const read = (file: string) => readFileSync(join(DIR, file), 'utf8')

const bicep = existsSync(join(DIR, 'main.bicep')) ? read('main.bicep') : ''
const paramFiles = existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith('.bicepparam')) : []

/** Strip `//` and block comments, so a name in prose is not taken for a setting. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

/** Object keys that look like environment variables: `  NAME_LIKE_THIS: value`. */
const envKeys = (source: string) =>
  [...code(source).matchAll(/^\s*([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*:/gm)].map(m => m[1])

describe('deploy/azure names only registered variables (AWTD-1468)', () => {
  it('has a template and at least one brand parameters file', () => {
    expect(bicep, 'deploy/azure/main.bicep is missing').not.toBe('')
    expect(paramFiles.length).toBeGreaterThan(0)
  })

  it('every variable main.bicep sets is in lib/env.ts', () => {
    const keys = envKeys(bicep)
    expect(keys.length).toBeGreaterThan(5)
    expect(keys.filter(k => !ENV_BY_NAME.has(k))).toEqual([])
  })

  it.each(paramFiles.length ? paramFiles : ['(none)'])('every variable %s sets is in lib/env.ts', file => {
    if (file === '(none)') return
    expect(envKeys(read(file)).filter(k => !ENV_BY_NAME.has(k))).toEqual([])
  })

  it('no brand file sets a NEXT_PUBLIC_* value, which is compiled into the image and ignored at runtime', () => {
    for (const file of paramFiles) {
      expect(envKeys(read(file)).filter(k => k.startsWith('NEXT_PUBLIC_')), file).toEqual([])
    }
  })

  it('supplies every required variable itself', () => {
    const keys = new Set(envKeys(bicep))
    expect(requiredVars().map(v => v.name).filter(name => !keys.has(name))).toEqual([])
  })
})

describe('deploy/azure follows the repo, not a copy of it (AWTD-1468)', () => {
  it('reads the cron schedule from vercel.json', () => {
    expect(code(bicep)).toMatch(/loadJsonContent\('\.\.\/\.\.\/vercel\.json'/)
  })

  it('every cron Job name fits the 32-character limit for the longest allowed prefix', () => {
    const maxPrefix = Number(code(bicep).match(/@maxLength\((\d+)\)\s*param name string/)?.[1])
    expect(maxPrefix, 'param name needs an @maxLength').toBeGreaterThan(0)
    const crons = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).crons as { path: string }[]
    for (const { path } of crons) {
      const jobName = `${'x'.repeat(maxPrefix)}-cron-${path.split('/').pop()}`
      expect(jobName.length, `${jobName} (from ${path})`).toBeLessThanOrEqual(32)
    }
  })

  it('runs each cron route through the runner’s one-shot mode, which the image ships', () => {
    expect(code(bicep)).toContain("'scripts/cron-runner.mjs'")
    expect(code(bicep)).toContain("'--run'")
    const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')
    expect(dockerfile).toContain('scripts/cron-runner.mjs')
  })

  it('keeps the job worker off by default until the image ships it (AWTD-1460)', () => {
    expect(code(bicep)).toMatch(/param deployWorker bool = false/)
  })
})
