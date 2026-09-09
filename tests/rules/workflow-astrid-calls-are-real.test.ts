/**
 * AWTD-875: a workflow may only call an Astrid route that exists, and must look
 * at the answer.
 *
 * This is the check AWTD-868 wished for. Two deploy workflows had been POSTing
 * to `/api/coding-agent/preview-ready` and `/api/coding-agent/deployment-complete`
 * on every run. Neither route was ever built — `preview-ready` appears once in
 * this repository's history, inside a `.backup` file Next.js does not load — so
 * both 404'd, silently, for as long as they had been shipping.
 *
 * Silently is the operative word, and it had a specific cause. Both calls ended
 * in `|| echo "Warning: ..."`, which CANNOT fire: `curl -s` exits 0 on a 404,
 * because an HTTP error is not a curl failure without `--fail`. It read as error
 * handling and was guaranteed dead code. So the two halves are checked together
 * here — a call to a route that does not exist, and a call whose answer nobody
 * reads, are the same bug seen from either end.
 *
 * The feature itself is the third block: the preview workflow posts its URL back
 * to the task, which is the half of AWTD-868 worth rebuilding.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { readdirSync, readFileSync, existsSync, statSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = process.cwd()
const WORKFLOW_DIR = join(ROOT, '.github/workflows')

function workflows(): { name: string; source: string }[] {
  return readdirSync(WORKFLOW_DIR)
    .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map(name => ({ name, source: readFileSync(join(WORKFLOW_DIR, name), 'utf8') }))
}

/** Lines that are entirely a YAML comment — the record of a REMOVED call. */
function withoutComments(source: string): string {
  return source
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n')
}

/**
 * Astrid API paths a workflow calls, from `"$ASTRID_WEBHOOK_URL/api/..."`.
 *
 * Comment lines are stripped first. Both removals in AWTD-868 left the dead
 * path named in prose so the next reader learns what happened, and a check that
 * forced those explanations to be deleted would be destroying the only record
 * of the bug it exists to prevent.
 */
export function astridApiPathsCalled(source: string): string[] {
  const paths = withoutComments(source).match(/\/api\/[A-Za-z0-9_\-/[\]$.{}]*/g) || []
  return [...new Set(paths.map(path => path.replace(/["'\\]/g, '')))]
}

/**
 * Does this API path resolve to a route file?
 *
 * Segments interpolated from the shell (`$TASK_ID`, `${{ ... }}`) match a
 * dynamic `[id]` directory, which is the only honest reading: the workflow does
 * not know the value and neither does this test.
 */
export function routeExistsFor(apiPath: string): boolean {
  const segments = apiPath.split('/').filter(Boolean)
  let dir = join(ROOT, 'app')

  for (const segment of segments) {
    const candidate = join(dir, segment)
    const isVariable = segment.startsWith('$')

    if (!isVariable && existsSync(candidate) && statSync(candidate).isDirectory()) {
      dir = candidate
      continue
    }

    // A dynamic segment — [id], [...slug] — or a route group, (marketing).
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return false
    }
    const dynamic = entries.find(
      entry =>
        entry.startsWith('[') &&
        statSync(join(dir, entry)).isDirectory(),
    )
    if (!dynamic) return false
    dir = join(dir, dynamic)
  }

  return existsSync(join(dir, 'route.ts')) || existsSync(join(dir, 'route.tsx'))
}

describe('workflows only call Astrid routes that exist (AWTD-875)', () => {
  it('every API path a workflow POSTs to resolves to a route file', () => {
    const dead = workflows().flatMap(({ name, source }) =>
      astridApiPathsCalled(source)
        .filter(path => !routeExistsFor(path))
        .map(path => `${name}: ${path}`),
    )

    expect(
      dead,
      'These workflows call routes that do not exist. curl -s exits 0 on a 404, ' +
        'so the call fails silently on every run — which is exactly how two of ' +
        'them shipped unnoticed (AWTD-868).',
    ).toEqual([])
  })

  it('resolves a dynamic segment, so a real call is not reported as dead', () => {
    expect(routeExistsFor('/api/v1/tasks/$TASK_ID/comments')).toBe(true)
    expect(routeExistsFor('/api/coding-agent/workflow-complete')).toBe(true)
  })

  it('recognises the two dead paths, so it cannot pass by resolving everything', () => {
    expect(routeExistsFor('/api/coding-agent/preview-ready')).toBe(false)
    expect(routeExistsFor('/api/coding-agent/deployment-complete')).toBe(false)
  })

  it('ignores a dead path named in a comment, which is a record and not a call', () => {
    const removal = '  # It POSTed to /api/coding-agent/preview-ready, never a live route.\n'
    expect(astridApiPathsCalled(removal)).toEqual([])
  })
})

describe('and read the answer (AWTD-875)', () => {
  it('no Astrid call is left to `curl -s ... || echo`, which cannot fire', () => {
    const swallowed = workflows().flatMap(({ name, source }) => {
      const lines = withoutComments(source).split('\n')
      return lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /\|\|\s*echo\s+["']?Warning/i.test(line))
        .map(({ index }) => `${name}:${index + 1}`)
    })

    expect(
      swallowed,
      'curl -s exits 0 on an HTTP error, so `|| echo "Warning: ..."` is dead ' +
        'code that reads as error handling. Capture %{http_code} and check it — ' +
        'see the Post Results to Astrid step in astrid-coding-agent.yml.',
    ).toEqual([])
  })

  it('every workflow that calls Astrid checks an HTTP status somewhere', () => {
    const unchecked = workflows()
      .filter(({ source }) => astridApiPathsCalled(source).length > 0)
      .filter(({ source }) => !/%\{http_code\}|HTTPSTATUS/.test(source))
      .map(({ name }) => name)

    expect(unchecked).toEqual([])
  })
})

/** One job's block: from its key to the next top-level job key. */
function jobBlock(source: string, jobName: string): string {
  const start = source.indexOf(`  ${jobName}:`)
  expect(start, `${jobName} is not a job in this workflow`).toBeGreaterThanOrEqual(0)
  const rest = source.slice(start + 1)
  const next = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('the preview URL reaches the task (AWTD-875)', () => {
  const preview = readFileSync(join(WORKFLOW_DIR, 'preview-deployment.yml'), 'utf8')

  it('extracts a task id from the PR', () => {
    expect(preview).toMatch(/task_id=/)
  })

  it('posts a comment to that task through the v1 API', () => {
    expect(preview).toMatch(/\/api\/v1\/tasks\/\$TASK_ID\/comments/)
  })

  it('carries the preview URL in what it posts', () => {
    expect(preview).toMatch(/PREVIEW_URL/)
  })

  it('sends a clientRequestId, so a busy PR gets one comment and not a dozen', () => {
    // The route honours it end to end (lib/comment-idempotency.ts): a replay
    // returns the existing comment and fires no side effects. Keyed on the PR,
    // not the deployment, because a branch's preview URL is stable.
    expect(preview).toMatch(/clientRequestId/)
  })

  it('runs for any PR naming a task, not only the coding agent\'s', () => {
    // The job this replaces was gated on the PR author being
    // astrid-code-assistant. A person's PR for a task deserves the link too,
    // and the acceptance criterion says "a PR that names one".
    //
    // Bounded to the job, and to its CODE. Two false positives on the way here,
    // both on prose that should stay: the summary job legitimately names the
    // agent when it labels an AI-authored PR, and this job's own comment says
    // what the gate used to be. What matters is that nothing EXECUTABLE tests
    // the author.
    expect(withoutComments(jobBlock(preview, 'notify-astrid-task')))
      .not.toMatch(/astrid-code-assistant/)
  })
})

/**
 * The task-id extraction, run for real.
 *
 * Asserting on the text of a shell snippet proves it was typed, not that it
 * works. This runs it the way Actions does — `bash -e` — which is the whole
 * point: `grep` exits 1 when it matches nothing, and under errexit a bare
 * pipeline in a command substitution takes the step down with it. Not finding a
 * task id is the NORMAL case, so that failure would have hit every pull request
 * in the repository that does not name one.
 */
function runExtractStep(prTitle: string, prBody: string): { exitCode: number; taskId: string } {
  const preview = readFileSync(join(WORKFLOW_DIR, 'preview-deployment.yml'), 'utf8')
  const step = jobBlock(preview, 'notify-astrid-task')
  const run = step.slice(step.indexOf('        run: |') + '        run: |'.length)
  const script = run
    .slice(0, run.indexOf('\n      - name:'))
    .split('\n')
    .map(line => line.replace(/^ {10}/, ''))
    .join('\n')

  const outputFile = join(mkdtempSync(join(tmpdir(), 'gh-output-')), 'output')
  execFileSync('bash', ['-c', 'touch "$1"', '_', outputFile])

  try {
    execFileSync('bash', ['-e', '-c', script], {
      env: { ...process.env, PR_TITLE: prTitle, PR_BODY: prBody, GITHUB_OUTPUT: outputFile },
      stdio: 'pipe',
    })
  } catch (error) {
    return { exitCode: (error as { status?: number }).status ?? 1, taskId: '' }
  }

  const written = readFileSync(outputFile, 'utf8')
  return { exitCode: 0, taskId: written.replace(/^task_id=/m, '').trim() }
}

describe('extracting the task id (AWTD-875)', () => {
  const TASK_ID = 'b6262552-95fe-4e2e-aac6-b7e0f837c6ef'

  it('finds an id in the PR title', () => {
    const result = runExtractStep(`AWTD-875 task_id: ${TASK_ID}`, '')
    expect(result.exitCode).toBe(0)
    expect(result.taskId).toBe(TASK_ID)
  })

  it('finds an id in the PR body', () => {
    const result = runExtractStep('A pull request', `Fixes it.\n\nTask-ID ${TASK_ID}\n`)
    expect(result.taskId).toBe(TASK_ID)
  })

  it('SUCCEEDS on a PR that names no task, which is most of them', () => {
    // Under `bash -e` a non-matching grep fails the step. Every ordinary PR in
    // the repository would have gone red on a notification it never wanted.
    const result = runExtractStep('Bump a dependency', 'No task here.')
    expect(result.exitCode).toBe(0)
    expect(result.taskId).toBe('')
  })

  it('cannot be talked into running a command from a PR title', () => {
    // Title and body arrive through env, never interpolated into the script.
    const result = runExtractStep('$(touch /tmp/pwned-by-pr-title) `id`', '; rm -rf /')
    expect(result.exitCode).toBe(0)
    expect(result.taskId).toBe('')
    expect(existsSync('/tmp/pwned-by-pr-title')).toBe(false)
  })
})
