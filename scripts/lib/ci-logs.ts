/**
 * Read CI logs from inside a cloud agent run (ADEV-338).
 *
 * The Claude step's GH_TOKEN is AGENT_GH_TOKEN, which has no Actions access, so `gh run view`
 * answered 403 and 17 runs handed a task back for want of a CI log. Since 2026-11-27 that token
 * carries Actions: Read on every app repo it covers (ADEV-340, Jon's decision: one token to renew,
 * not a second Actions-only secret, and never the job's write-scoped `github.token`). So this
 * reads with GH_TOKEN itself, and `--repo` reaches astrid-core and the other app repos. This file
 * builds the only `gh` calls scripts/ci-logs.ts makes, all of them reads.
 */

export type CiLogsTarget = { kind: 'run'; runId: string } | { kind: 'branch'; branch: string } | { kind: 'pr'; number: string }

export interface CiLogsArgs {
  target: CiLogsTarget
  tail: number
  /** `owner/name`; omitted, gh uses the current checkout's repo. */
  repo?: string
}

export const DEFAULT_TAIL = 200

/** `--run <id>`, `--branch <name>` or `--pr <number>` (exactly one), an optional `--tail <lines>` and `--repo <owner/name>`. */
export function parseCiLogsArgs(argv: readonly string[]): CiLogsArgs {
  const value = (name: string) => {
    const i = argv.indexOf(name)
    return i === -1 ? undefined : argv[i + 1]
  }
  const run = value('--run')
  const branch = value('--branch')
  const pr = value('--pr')
  const given = [run, branch, pr].filter(v => v !== undefined)
  if (given.length !== 1) throw new Error('Give exactly one of --run <id>, --branch <name>, --pr <number>')
  const rawTail = value('--tail')
  const tail = rawTail === undefined ? DEFAULT_TAIL : Number(rawTail)
  if (!Number.isInteger(tail) || tail < 1 || tail > 5000) throw new Error('--tail must be a whole number from 1 to 5000')
  const repo = value('--repo')
  if (argv.includes('--repo') && (repo === undefined || !/^[\w.-]+\/[\w.-]+$/.test(repo))) {
    throw new Error('--repo must be owner/name, e.g. Graceful-Tools/astrid-core')
  }
  const withRepo = repo === undefined ? {} : { repo }
  if (run !== undefined) {
    if (!/^\d+$/.test(run)) throw new Error('--run must be a numeric run id')
    return { target: { kind: 'run', runId: run }, tail, ...withRepo }
  }
  if (pr !== undefined) {
    if (!/^\d+$/.test(pr)) throw new Error('--pr must be a pull request number')
    return { target: { kind: 'pr', number: pr }, tail, ...withRepo }
  }
  // A branch name is passed to gh as one argument, never through a shell; this only refuses
  // a value that would read as a flag.
  if (!branch || branch.startsWith('-')) throw new Error('--branch must be a branch name')
  return { target: { kind: 'branch', branch }, tail, ...withRepo }
}

/** The environment for a `gh` read: the agent's own GH_TOKEN, and no prompts. */
export function ciLogsEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  if (!env.GH_TOKEN) throw new Error('GH_TOKEN is not set: agent-run.yml passes AGENT_GH_TOKEN, which reads Actions (ADEV-340)')
  return { ...env, GH_PROMPT_DISABLED: '1' }
}

const onRepo = (repo?: string) => (repo ? ['--repo', repo] : [])

/** The last `lines` lines of a log: the failure is at the end, and the start is setup noise. */
export function tailLines(text: string, lines: number): string {
  const all = text.replace(/\n+$/, '').split('\n')
  if (all.length <= lines) return all.join('\n')
  return [`… ${all.length - lines} earlier lines omitted (raise --tail to see more)`, ...all.slice(-lines)].join('\n')
}

/** `gh run list` arguments for the runs of a branch, newest first. */
export function runListArgs(branch: string, repo?: string): string[] {
  return ['run', 'list', '--branch', branch, '--limit', '10', '--json', 'databaseId,workflowName,status,conclusion,headSha,url', ...onRepo(repo)]
}

/** `gh pr view` arguments that resolve a PR number to its head branch. */
export function prBranchArgs(number: string, repo?: string): string[] {
  return ['pr', 'view', number, '--json', 'headRefName', '--jq', '.headRefName', ...onRepo(repo)]
}

/** `gh run view` arguments for a run's failed-step logs. */
export function failedLogArgs(runId: string, repo?: string): string[] {
  return ['run', 'view', runId, '--log-failed', ...onRepo(repo)]
}
