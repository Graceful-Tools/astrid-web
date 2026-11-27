import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ADEV-338: the workflow text the cloud-run fixes depend on. Reading source is the behaviour here.
const workflow = readFileSync('.github/workflows/agent-run.yml', 'utf8')
const allowed = /--allowedTools "([^"]+)"/.exec(workflow)?.[1] ?? ''

describe('ADEV-338: agent-run.yml', () => {
  it('passes the job token to the Claude step under its own name, and ci:logs is an npm script', () => {
    expect(workflow).toContain('CI_LOGS_GH_TOKEN: ${{ github.token }}')
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['ci:logs']).toBe('tsx scripts/ci-logs.ts')
  })

  it('adds the read-only npm and node commands, and nothing that installs or downloads', () => {
    for (const tool of ['Bash(npm view *)', 'Bash(npm ls *)', 'Bash(node *)']) expect(allowed).toContain(tool)
    expect(allowed).not.toMatch(/npx \*|npm install|gh run|gh api/)
  })

  it('gives the Claude step 100 minutes inside a 115-minute job, and tells the agent to push by minute 80', () => {
    expect(workflow).toMatch(/id: claude\n\s+timeout-minutes: 100/)
    expect(workflow).toMatch(/\n {4}timeout-minutes: 115\n/)
    expect(readFileSync('.github/agent-run-prompt.md', 'utf8')).toContain('By minute 80')
  })

  it('does not file a renewal task for a usage limit', () => {
    expect(workflow).toContain("steps.auth.outputs.limited != 'true'")
  })
})
