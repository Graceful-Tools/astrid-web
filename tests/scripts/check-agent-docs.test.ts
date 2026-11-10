import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

it('AWTD-1552 checks bracketed inline-code link labels and remains warn-only', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-docs-'))
  try {
    mkdirSync(path.join(root, 'scripts'))
    mkdirSync(path.join(root, 'docs'))
    copyFileSync('scripts/check-agent-docs.mjs', path.join(root, 'scripts/check-agent-docs.mjs'))
    writeFileSync(path.join(root, 'package.json'), '{}')
    writeFileSync(path.join(root, 'docs/existing.md'), '# Existing\n')
    writeFileSync(path.join(root, 'docs/AGENT_INTEGRATION_SUPPORT_MATRIX.md'), [
      '[`/tasks/[id]/claim`](./existing.md)',
      '[`/tasks/[id]/claim`](./missing-route.md)',
      '[Plain label](./missing-plain.md)',
      '![Image label](./missing-image.png)',
      '```md',
      '[`/tasks/[id]`](./ignored-example.md)',
      '```',
    ].join('\n'))

    const result = spawnSync(process.execPath, [path.join(root, 'scripts/check-agent-docs.mjs')], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toContain(
      'WARN docs/AGENT_INTEGRATION_SUPPORT_MATRIX.md:2 links to missing path ./missing-route.md',
    )
    expect(result.stderr).toContain(':3 links to missing path ./missing-plain.md')
    expect(result.stderr).toContain(':4 links to missing path ./missing-image.png')
    expect(result.stderr).not.toContain('links to missing path ./existing.md')
    expect(result.stderr).not.toContain('ignored-example.md')
    expect(result.stdout).toContain('this check is warn-only.')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
