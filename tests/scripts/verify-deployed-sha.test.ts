/**
 * Asking production which commit it is serving.
 *
 * AWTD-959. The deploy step decided success by regexing a URL out of
 * `vercel deploy` stdout. When the CLI hung and the runner cancelled the step,
 * two runs reported FAILED about a deploy that had in fact gone out — and the
 * Health Check, gated on that job, was skipped, so the one run where production
 * was actually broken had no verification at all.
 *
 * Production answers the question directly. /api/health carries
 * VERCEL_GIT_COMMIT_SHA as `commitSha`, and during the incident it read
 * 25712912185a3ebc268b40756ac622b40ec02dd4 — the very SHA the job called a
 * failure. The fixture below is that real payload, trimmed.
 *
 * These exercise the parse-and-compare half via --from-json-file. The polling
 * half is curl and a clock, which a unit test cannot pin and which the workflow
 * ratchet (tests/rules/production-deploy-reports-honestly.test.ts) covers by
 * requiring the script to be called at all.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts/verify-deployed-sha.sh')
const DEPLOYED = '25712912185a3ebc268b40756ac622b40ec02dd4'

/** The real production payload from the incident, trimmed to the relevant keys. */
const HEALTHY = JSON.stringify({
  status: 'healthy',
  timestamp: '2026-09-19T04:49:25.323Z',
  database: { healthy: true, responseTime: '6ms' },
  environment: 'production',
  version: DEPLOYED,
  commitSha: DEPLOYED,
  buildTimestamp: DEPLOYED,
})

const dir = mkdtempSync(join(tmpdir(), 'verify-sha-'))

function verify(expectedSha: string, payload: string): { status: number; output: string } {
  const file = join(dir, `${Buffer.from(payload).length}-${expectedSha}.json`)
  writeFileSync(file, payload)
  try {
    const stdout = execFileSync('bash', [SCRIPT, expectedSha, '--from-json-file', file], {
      encoding: 'utf8',
    })
    return { status: 0, output: stdout }
  } catch (error) {
    const err = error as { status: number; stdout?: string; stderr?: string }
    return { status: err.status, output: (err.stdout ?? '') + (err.stderr ?? '') }
  }
}

describe('verify-deployed-sha.sh (AWTD-959)', () => {
  it('accepts the commit production says it is serving', () => {
    expect(verify(DEPLOYED, HEALTHY).status).toBe(0)
  })

  it('accepts an abbreviated SHA, since GITHUB_SHA and --short disagree in length', () => {
    expect(verify('25712912', HEALTHY).status).toBe(0)
  })

  it('rejects a different commit, and says what is actually live', () => {
    const result = verify('0000000000000000000000000000000000000000', HEALTHY)
    expect(result.status).toBe(1)
    expect(result.output).toContain(DEPLOYED)
  })

  it('rejects "unknown" rather than treating it as a match', () => {
    // getDeployedCommitSha() returns the literal string 'unknown' when no
    // VERCEL_GIT_COMMIT_SHA is set. A prefix comparison against a short SHA
    // must not be fooled by it, and it is never evidence of anything.
    const result = verify('unknown', JSON.stringify({ commitSha: 'unknown' }))
    expect(result.status).toBe(1)
  })

  it('rejects a payload with no commitSha at all', () => {
    const result = verify(DEPLOYED, JSON.stringify({ status: 'healthy' }))
    expect(result.status).toBe(1)
  })

  it('rejects an error page that is not JSON', () => {
    const result = verify(DEPLOYED, '<html><body>502 Bad Gateway</body></html>')
    expect(result.status).toBe(1)
  })

  it('reads commitSha rather than the neighbouring version field', () => {
    // Both carry the SHA today. `version` is the one likely to be repurposed
    // into a package version, at which point matching it would report a
    // successful deploy on every run.
    const drifted = JSON.stringify({ version: '0.1.0', commitSha: DEPLOYED })
    expect(verify(DEPLOYED, drifted).status).toBe(0)
  })

  it('exits 2 without an expected SHA, rather than passing vacuously', () => {
    try {
      execFileSync('bash', [SCRIPT], { encoding: 'utf8', stdio: 'pipe' })
      throw new Error('expected a non-zero exit')
    } catch (error) {
      expect((error as { status: number }).status).toBe(2)
    }
  })
})
