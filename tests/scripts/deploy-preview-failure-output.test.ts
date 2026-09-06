/**
 * RED for task 800e00fc.
 *
 * `deploy-preview.sh --production` printed one line, exited 1, and said nothing
 * about why. Nothing had deployed, and the only way to discover that was to ask
 * the Vercel API what production was serving.
 *
 * Two faults combined. The deploy output goes into a variable that is never
 * printed on the production path, and `set -e` aborts the script the moment the
 * command substitution fails — before even the empty-URL case is reached. The
 * preview path has an empty-URL guard; production never got one.
 *
 * docs/CLI_OPERATIONS.md §0 warns four times over about believing something
 * shipped when it did not. A deploy tool that fails silently is the strongest
 * version of that failure, so these tests drive the script with a stubbed
 * `vercel` on PATH rather than asserting on its source.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../scripts/deploy-preview.sh')

let binDir: string

function stubVercel(body: string) {
  const npx = path.join(binDir, 'npx')
  fs.writeFileSync(npx, `#!/usr/bin/env bash\n${body}\n`)
  fs.chmodSync(npx, 0o755)
}

function runProduction(): { status: number; output: string } {
  try {
    const stdout = execFileSync('bash', [SCRIPT, '--production'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        VERCEL_TOKEN: 'test-token',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, output: stdout }
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

beforeEach(() => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-stub-'))
})

afterEach(() => {
  fs.rmSync(binDir, { recursive: true, force: true })
})

describe('deploy-preview.sh --production', () => {
  it('fails loudly, showing the error, when the deploy command fails', () => {
    stubVercel('echo "Error: You do not have permission" >&2; exit 1')

    const { status, output } = runProduction()

    expect(status).not.toBe(0)
    expect(output).toContain('You do not have permission')
  })

  it('fails when the deploy exits zero but produced no deployment URL', () => {
    // A silent success with no URL means nothing shipped.
    stubVercel('echo "nothing useful here"; exit 0')

    const { status, output } = runProduction()

    expect(status).not.toBe(0)
    expect(output).toContain('nothing useful here')
  })

  it('redacts the Vercel token from error output', () => {
    // Vercel's own failure payload echoes a retry command containing
    // --token=<secret>, so printing deploy output would leak it into a
    // terminal, a CI log, or a pasted bug report.
    stubVercel('echo "retry: vercel deploy --token=sup3rs3cr3ttoken --scope x" >&2; exit 1')

    const { status, output } = runProduction()

    expect(status).not.toBe(0)
    expect(output).not.toContain('sup3rs3cr3ttoken')
    expect(output).toContain('REDACTED')
  })

  it('reports the deployment URL on success', () => {
    stubVercel('echo "https://astrid-abc123-gracefultools.vercel.app"; exit 0')

    const { status, output } = runProduction()

    expect(status).toBe(0)
    expect(output).toContain('https://astrid-abc123-gracefultools.vercel.app')
  })
})
