/**
 * Did the cloud harness ever start (ADEV-236)?
 *
 * On 2026-11-22 the Claude Code token was revoked. Every worker claimed a task, `claude -p`
 * exited 1 within seconds, and the end-of-run release counted it as "ended before finishing
 * it". The second such release handed the task back to Jon as "failed twice", although no work
 * was ever attempted.
 *
 * The harness's stdout is tee'd to the transcript, so a failed harness step with nothing in the
 * transcript never got as far as doing anything: an authentication failure, a missing binary, a
 * crash on start. That release says so and does not count (doing-release.ts, START_FAILURE_MARKER).
 * A harness that printed anything started, and its failure counts as before.
 */
export function harnessStartFailure(input: { outcome: string; transcript: string }): string | null {
  if (input.outcome !== 'failure') return null
  if (input.transcript.trim().length > 0) return null
  return 'the harness exited before producing any output (for example, it could not authenticate)'
}

/**
 * ADEV-338: the renewal task's urgency. The token was dead for about three days and nothing the
 * owner reads said so: the task sat in the Inbox with no date. Top priority, due now, with a push
 * and email reminder.
 */
export function renewalUrgency(now: Date): { priority: 3; dueDateTime: string; reminderTime: string; reminderType: 'both' } {
  const at = now.toISOString()
  return { priority: 3, dueDateTime: at, reminderTime: at, reminderType: 'both' }
}

/**
 * ADEV-338: Claude Code's usage-limit answer ("You've hit your weekly limit · resets Nov 20").
 * That is not a revoked token: nothing to renew, no task to file, and no worker should claim a
 * task it cannot work. Returns the reset text, or null when the output is not a limit message.
 */
export function usageLimitReset(output: string): string | null {
  const match = /hit your (?:weekly |daily |usage |5-hour |session )?limit(?:\s*[·•|–—-]\s*resets?\s+([^\n]*))?/i.exec(output)
  if (!match) return null
  return (match[1] ?? '').trim() || 'unknown'
}

/** Every token-renewal task starts with this, so a red run every half hour files only one. */
export const RENEW_TOKEN_TITLE = 'Renew the Claude Code token for cloud agent runs'

/** An open renewal task already on the board, or null. Completing it lets the next failure file a new one. */
export function openRenewalTask<T extends { title?: string | null; completed?: boolean }>(tasks: T[]): T | null {
  return tasks.find(task => !task.completed && (task.title ?? '').startsWith(RENEW_TOKEN_TITLE)) ?? null
}

/** The renewal task's description: what failed, and the exact steps only the token's owner can take. */
export function renewalDescription(input: { runUrl: string; repo: string }): string {
  return [
    `A cloud agent run could not start Claude Code: the token in \`CLAUDE_CODE_OAUTH_TOKEN\` was refused (${input.runUrl}).`,
    'No cloud worker claims a task until it works again, so nothing on the board is held or handed back meanwhile.',
    '',
    'Only the token\'s owner can fix this:',
    '1. On the Mac: `claude setup-token`, and copy the token it prints.',
    `2. \`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${input.repo} --env agent\`, and paste it.`,
    '   It must be the `agent` environment\'s secret: agent-run.yml runs in that environment, and its',
    '   copy overrides a repo-level secret of the same name, so setting the repo one changes nothing (ADEV-235).',
    '3. Optional: `gh workflow run agent-run.yml --ref main`, and check that the "Check the Claude Code token" step passes.',
    '',
    'Then complete this task. (Filed by agent-run.yml, ADEV-236; it files one task at a time.)',
  ].join('\n')
}
