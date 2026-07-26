/**
 * Regression: repo scripts called dotenv.config() without `override`, so a
 * stale `export ASTRID_OAUTH_CLIENT_SECRET=...` in a developer's ~/.zshrc beat
 * the correct value in .env.local. Every OAuth script died with
 * `invalid_client` while the identical request succeeded via curl.
 *
 * Pin that .env.local wins over inherited shell env, and that we stay inert
 * when no .env.local exists (CI / Vercel, where the platform injects env).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadScriptEnv } from '../../scripts/lib/load-env'

const VAR = 'ASTRID_TEST_ONLY_OAUTH_SECRET'
const OTHER = 'ASTRID_TEST_ONLY_UNSET_VAR'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  delete process.env[VAR]
  delete process.env[OTHER]
})

function writeEnvLocal(contents: string) {
  fs.writeFileSync(path.join(tmpDir, '.env.local'), contents)
}

describe('loadScriptEnv', () => {
  it('lets .env.local win over an inherited shell export', () => {
    process.env[VAR] = 'stale-value-from-zshrc'
    writeEnvLocal(`${VAR}=correct-value-from-env-local\n`)

    const result = loadScriptEnv({ cwd: tmpDir })

    expect(process.env[VAR]).toBe('correct-value-from-env-local')
    expect(result.overridden).toContain(VAR)
  })

  it('sets variables that were not already in the environment', () => {
    writeEnvLocal(`${OTHER}=fresh\n`)

    const result = loadScriptEnv({ cwd: tmpDir })

    expect(process.env[OTHER]).toBe('fresh')
    // Nothing was shadowed — it simply did not exist before.
    expect(result.overridden).not.toContain(OTHER)
  })

  it('does not report an override when the values already agree', () => {
    process.env[VAR] = 'same'
    writeEnvLocal(`${VAR}=same\n`)

    const result = loadScriptEnv({ cwd: tmpDir })

    expect(result.overridden).not.toContain(VAR)
  })

  it('is inert when no .env.local exists, leaving injected env alone', () => {
    process.env[VAR] = 'from-ci'

    const result = loadScriptEnv({ cwd: tmpDir })

    expect(result.path).toBeNull()
    expect(result.overridden).toEqual([])
    expect(process.env[VAR]).toBe('from-ci')
  })
})
