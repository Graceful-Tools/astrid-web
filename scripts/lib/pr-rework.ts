/**
 * Send finished agent work back when its PR can no longer land (ADEV-200).
 *
 * A cloud run that finishes a task opens a PR, ends its report with
 * `AWAITING-DEPLOY: <head>` and leaves the task in Doing. The ship workflow lands
 * the PR once it is green and mergeable. Until ADEV-200, a PR that stopped being
 * mergeable (a parallel PR merged into the same files) or whose checks finished
 * red was held back on every tick and nothing else happened: the stale-Doing
 * sweep skips a current AWAITING-DEPLOY marker on purpose, and the queue never
 * shows Doing. On 2026-11-22 three finished tasks sat there for hours, their PRs
 * CONFLICTING, while every tick logged "held back".
 *
 * So such a PR goes back to its agent: a comment that names the PR, branch, head
 * and reason, opening with `REWORK_MARKER` (it supersedes the AWAITING-DEPLOY
 * marker, see `isCurrentMarker` in doing-release.ts), then Doing → Ready with the
 * assignee kept. The next run resumes from the branch and restates the marker.
 *
 * Only a LIVE handoff is sent back: valid against the board and with a current
 * marker. Once sent back, the task is in Ready and its marker is superseded, so a
 * later tick does not send it again, and a run already reworking it (Doing, no
 * fresh marker yet) is left alone.
 */

import { REWORK_MARKER } from './doing-release'

export { REWORK_MARKER }

export interface ReworkCandidate {
  number: number
  headRefName: string
  headRefOid?: string
  isDraft?: boolean
  mergeable?: string
  /** Revalidated against the board: Doing/Testing, the branch's agent, marker = head. */
  cloudHandoffValid?: boolean
  /** The agent's AWAITING-DEPLOY marker is newer than any release, redo claim or rework. */
  handoffCurrent?: boolean
  checks?: Array<{ name: string; bucket: string }>
}

/** Why this PR must go back to its agent, or null when it should simply wait or land. */
export function reworkReason(pr: ReworkCandidate): string | null {
  if (!pr.headRefName.startsWith('agent/') || pr.cloudHandoffValid !== true || pr.handoffCurrent !== true) return null
  if (pr.isDraft || !pr.headRefOid) return null
  if (pr.mergeable === 'CONFLICTING') return 'it conflicts with main'
  const checks = pr.checks ?? []
  // Still running: the verdict is not in yet, so wait for it.
  if (checks.some(check => check.bucket === 'pending')) return null
  const failing = checks.filter(check => check.bucket === 'fail' || check.bucket === 'cancel')
  if (failing.length) return `its checks finished red (${failing.map(check => check.name).join(', ')})`
  return null
}

/** The comment that sends the task back. It opens with REWORK_MARKER so it supersedes the old marker. */
export function reworkComment(input: { number: number; branch: string; headSha: string; reason: string }): string {
  return [
    `${REWORK_MARKER}: PR #${input.number} cannot land because ${input.reason}.`,
    '',
    `The finished work is on \`${input.branch}\` at \`${input.headSha.slice(0, 8)}\`. Resume from that branch:`,
    '1. Merge `origin/main` into it and resolve the conflicts, or fix what the red check reports.',
    '   A known flake (the Firefox passkey e2e) needs only a re-run of the failed job.',
    '2. Run the gates again and push the same branch, so the same PR updates.',
    '3. End the report with a fresh `AWAITING-DEPLOY: <new head sha>`.',
    '',
    'Moved back to Ready, still assigned, so the next run picks it up.',
  ].join('\n')
}
