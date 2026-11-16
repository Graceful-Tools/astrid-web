/**
 * Which earlier agent-run artifact may carry the wake state a new run restores.
 *
 * Since ADEV-26 a run is N workers, each uploading `agent-run-<harness>-<run id>-slot-<n>`.
 * Only slot 1 answers the inbox and keeps wake state, so only its artifact (or a
 * pre-ADEV-26 one, which has no slot suffix) is worth downloading. None of this run's own
 * artifacts count: a sibling slot that finished first has uploaded already, and its
 * state is not a previous run's.
 */
export function isRetainedWakeStateArtifact(name: string, harness: string, runId: string | undefined): boolean {
  const prefix = `agent-run-${harness}-`
  if (!name.startsWith(prefix)) return false
  const match = /^(\d+)(?:-slot-(\d+))?$/.exec(name.slice(prefix.length))
  if (!match) return false
  if (runId && match[1] === runId) return false
  return match[2] === undefined || match[2] === '1'
}
