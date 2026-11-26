/**
 * The words a system comment uses when a task's result is in (ADEV-279). A system comment has no
 * author to speak for it, so it states plainly where the numbers came from and what moved. Pure.
 *
 * Decision cards follow docs/DECISIONS.md: a bold `**Decision:**` paragraph, numbered options
 * `- **1.** …` with `(recommended)` on exactly one, no `AGENT-HANDBACK:` line (nobody resumes work
 * from this one: a person reads it and moves the task).
 */
import type { ExperimentRecommendation, ExperimentVerdict } from '@/lib/task-experiment'
import type { HandBackReason } from '@/lib/results-rules'

export interface ReportedResult {
  kind: 'experiment' | 'verification'
  verdict: ExperimentVerdict | null
  /** An experiment's link out, when the service gave one. */
  url: string | null
  recommendation: ExperimentRecommendation | null
  /** A verification's per-goal and per-guardrail lines. */
  lines: string[]
  /** An experiment's per-metric lines, from the service's own numbers. */
  metricLines: string[]
}

const VERDICT_PHRASE: Record<ExperimentVerdict, string> = {
  improving: 'improving',
  flat: 'flat: no measurable change',
  regressing: 'regressing',
  inconclusive: 'inconclusive',
}

/** The system comment when a link concludes. Says nothing about moving the task: that is the lane's. */
export function resultReportComment(result: ReportedResult): string {
  const source = result.kind === 'verification' ? 'The verification window ended' : 'The experiment reported'
  const verdict = result.verdict ? VERDICT_PHRASE[result.verdict] : 'no verdict'
  const body = [`**Result is in:** ${source}: ${verdict}.`]
  const lines = result.kind === 'verification' ? result.lines : result.metricLines
  if (lines.length) body.push('', ...lines.map(line => (line.startsWith('- ') ? line : `- ${line}`)))
  if (result.recommendation) {
    body.push('', `The service recommends **${result.recommendation.action}**${result.recommendation.reason ? `: ${result.recommendation.reason}` : '.'}`)
  }
  if (result.url) body.push('', `[Open the experiment](${result.url})`)
  return body.join('\n')
}

/** The system comment when the lane completes a task whose results passed. */
export function resultsPassedComment(report: string): string {
  return `**Results passed.** Every result this task waited on came in improving, so it is complete.\n\n${report}`
}

const HAND_BACK_REASON: Record<HandBackReason, string> = {
  regressing: 'a result found a regression',
  silent: 'the deadline came and a source had nothing to say',
  inconclusive: 'the deadline came and the result was inconclusive',
  noCondition: 'nothing is measuring this task any more',
}

/** The Decision card handed back with a task whose results did not pass. Rollback is never automatic. */
export function resultsHandBackComment(reason: HandBackReason, report: string): string {
  return [
    `**Results did not pass:** ${HAND_BACK_REASON[reason]}. Nothing has been rolled back.`,
    '',
    report,
    '',
    '**Decision:** What should happen to this work?',
    '',
    '- **1.** Iterate: keep the change and try again (recommended)',
    '- **2.** Roll back: undo the change',
    '- **3.** Ship anyway: keep it as it is',
  ].join('\n')
}
