/**
 * ADEV-279 / ADEV-281 — the cloud runner could not re-pin astrid-rules.
 *
 * On 2026-11-26 both Goal signals web tasks stopped at the same step, three runs in a row:
 * `scripts/build-astrid-rules.sh --rev <sha>` "requires approval", which an unattended
 * `claude -p` cannot give. Its allowlist (agent-run.yml) admits `npm run *`, so the re-pin is
 * an npm script and the runner prompt names it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('the runner can re-pin astrid-rules (ADEV-279)', () => {
  it('package.json runs the re-pin script', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>
    expect(scripts['build:astrid-rules']).toBe('bash scripts/build-astrid-rules.sh')
  })

  it('the runner allowlist admits npm scripts', () => {
    expect(read('.github/workflows/agent-run.yml')).toContain('Bash(npm run *)')
  })

  it('the runner prompt tells a worker to re-pin through npm, with the core checkout', () => {
    const prompt = read('.github/agent-run-prompt.md')
    expect(prompt).toContain('npm run build:astrid-rules -- --rev <core sha> --core "$ASTRID_CORE_DIR"')
  })
})
