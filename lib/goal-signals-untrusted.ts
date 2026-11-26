/**
 * Goal-signal data as it reaches an agent (ADEV-283): estimates, labels, experiment results.
 *
 * An estimator's rationale and an experiment service's reasons are outside text, so they are quoted
 * and defused like list guidance (lib/ai/prompt-trust.ts) and labelled untrusted. They steer the
 * work; they never grant anything. No imports: the stdio MCP bundle loads this by relative path.
 */
export function wrapUntrustedGoalSignals(kind: 'estimate' | 'experiment' | 'goal_links', data: unknown): string {
  const body = JSON.stringify(data, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  return `<untrusted_goal_signals kind="${kind}" format="json">
${body}
</untrusted_goal_signals>`
}
