/**
 * Read CI logs from inside a cloud agent run (ADEV-338).
 *
 * The Claude step's GH_TOKEN is AGENT_GH_TOKEN, which has no Actions access, so `gh run view`
 * answers 403 and 17 runs handed a task back for want of a CI log. The job's own
 * `github.token` carries `actions: read`; agent-run.yml passes it under CI_LOGS_GH_TOKEN so it
 * never replaces GH_TOKEN (which pushes branches and opens PRs). This file builds the only
 * `gh` calls scripts/ci-logs.ts makes, all of them reads.
 */

export type CiLogsTarget = { kind: 'run'; runId: string } | { kind: 'branch'; branch: string } | { kind: 'pr'; number: string }

export interface CiLogsArgs {
  target: CiLogsTarget
  tail: number
}

export const DEFAULT_TAIL = 200

/** `--run <id>`, `--branch <name>` or `--pr <number>` (exactly one), and an optional `--tail <lines>`. */
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
  if (run !== undefined) {
    if (!/^\d+$/.test(run)) throw new Error('--run must be a numeric run id')
    return { target: { kind: 'run', runId: run }, tail }
  }
  if (pr !== undefined) {
    if (!/^\d+$/.test(pr)) throw new Error('--pr must be a pull request number')
    return { target: { kind: 'pr', number: pr }, tail }
  }
  // A branch name is passed to gh as one argument, never through a shell; this only refuses
  // a value that would read as a flag.
  if (!branch || branch.startsWith('-')) throw new Error('--branch must be a branch name')
  return { target: { kind: 'branch', branch }, tail }
}

/** The environment for a `gh` read: the CI-logs token stands in for GH_TOKEN. */
export function ciLogsEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const token = env.CI_LOGS_GH_TOKEN
  if (!token) throw new Error('CI_LOGS_GH_TOKEN is not set: this script runs inside agent-run.yml, which passes the job token')
  return { ...env, GH_TOKEN: token, GITHUB_TOKEN: token, GH_PROMPT_DISABLED: '1' }
}

/** The last `lines` lines of a log: the failure is at the end, and the start is setup noise. */
export function tailLines(text: string, lines: number): string {
  const all = text.replace(/\n+$/, '').split('\n')
  if (all.length <= lines) return all.join('\n')
  return [`… ${all.length - lines} earlier lines omitted (raise --tail to see more)`, ...all.slice(-lines)].join('\n')
}

/** `gh run list` arguments for the runs of a branch, newest first. */
export function runListArgs(branch: string): string[] {
  return ['run', 'list', '--branch', branch, '--limit', '10', '--json', 'databaseId,workflowName,status,conclusion,headSha,url']
}

/** `gh pr view` arguments that resolve a PR number to its head branch. */
export function prBranchArgs(number: string): string[] {
  return ['pr', 'view', number, '--json', 'headRefName', '--jq', '.headRefName']
}

/** `gh run view` arguments for a run's failed-step logs. */
export function failedLogArgs(runId: string): string[] {
  return ['run', 'view', runId, '--log-failed']
}
