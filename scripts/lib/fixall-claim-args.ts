/**
 * Argv for `scripts/claim-fixall-task.ts`, parsed where it can be tested.
 *
 * AWTD-922. The script used to build its positionals like this:
 *
 *     process.argv.slice(2).filter(arg => !arg.startsWith("--"))
 *
 * which drops the FLAG and keeps its VALUE. So `<id> ready --agent claude` — the
 * form docs/FIXALL_WORKFLOW.md and .claude/commands/fixall.md both prescribe —
 * sent `commentWatermark: "claude"`, and the server rightly refused it: a ready
 * claim must not carry a watermark. Every local harness claim failed. Only CI
 * worked, because .github/workflows/fixall.yml passes three positionals and no
 * flag, so the one exercised path was the one that happened to be correct.
 *
 * A flag and its value have to be consumed TOGETHER; a prefix filter cannot see
 * that `claude` belongs to the `--agent` before it. Hence a single left-to-right
 * pass rather than two independent scans of the same array.
 */

/** Flags that take a value, so the value is consumed with the flag. */
const VALUED_FLAGS = new Set(['--agent'])

export interface ClaimArgs {
  taskId: string
  action: string
  /** Null for a ready claim, and for CI's unconditionally-interpolated "". */
  commentWatermark: string | null
  /** Undefined means the caller did not say — the server then defaults to Copilot. */
  agent: string | undefined
}

export function parseClaimArgs(argv: string[]): ClaimArgs {
  const positional: string[] = []
  const flags: Record<string, string> = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    if (!VALUED_FLAGS.has(arg)) continue
    const value = argv[i + 1]
    // A following flag is a missing value, not a mailbox. Defaulting here would
    // hand a Claude Code run's task to Copilot on a typo, so this is fatal: the
    // default is for callers that omit the flag, not ones that mistype it.
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${arg} requires a value`)
    }
    flags[arg] = value
    i++ // consume the value, so it never reaches `positional`
  }

  const [taskId, action, commentWatermark = ''] = positional
  if (!taskId || !action) {
    throw new Error(
      'Usage: claim-fixall-task.ts <task-id> <ready|recheck|review> [comment-watermark] [--agent <mailbox>]',
    )
  }

  return {
    taskId,
    action,
    commentWatermark: commentWatermark || null,
    agent: flags['--agent'],
  }
}
