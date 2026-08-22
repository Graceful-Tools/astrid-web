/**
 * Which Astrid tasks belong to the deployment monitor.
 *
 * Task d893debc. `resolveDeploymentTasks()` selected tasks with a substring
 * match on four very common English words — 'deployment failure', 'deployment
 * monitoring', 'vercel', 'build' — then posted a canned "Deployment Issues
 * Resolved" comment and tried to complete them.
 *
 * On the live board that selected:
 *
 *   "Delete the vestigial listType:'status' rows once iOS BUILD 200 is adopted"
 *
 * a substantive open task about iOS adoption, unrelated to any deployment. It
 * got the resolution comment. "🔴 Predeploy Failed: Build" would match too, as
 * would anything mentioning a build step, a build error, or Vercel in passing.
 *
 * IT HAS NOT DESTROYED THE BOARD ONLY BY ACCIDENT: updateAstridTask sent PATCH
 * to a route that exports GET, PUT and DELETE, so every completion returned 405
 * and the task survived — while the misleading comment went out anyway, because
 * the comment is posted first. Fixing the 405 without fixing this filter would
 * have started silently closing real bugs.
 *
 * So the rule is: match the marker this script WRITES, never the words a human
 * might type. Two independent conditions, because they fail differently — the
 * tag says "this is one of mine", and the fingerprint says "this is about a
 * specific deployment I recorded".
 */

export interface MonitorTaskLike {
  id?: string
  title?: string | null
  description?: string | null
  completed?: boolean | null
}

/**
 * Written into every task this script creates, and matched on read.
 *
 * An explicit tag rather than a title convention: titles get edited by people,
 * and the moment someone rewords one, a title-shaped rule either stops matching
 * its own task or starts matching theirs.
 */
export const DEPLOY_MONITOR_TAG = '[deploy-monitor]'

/**
 * The heading this script writes into every deployment task's description.
 * Recognises tasks created before the tag existed, without falling back to
 * matching bare English.
 */
const LEGACY_DESCRIPTION_MARKER = '## Deployment Error Details'

/** Exact title prefixes this script creates. Not substrings of common words. */
const LEGACY_TITLE_PREFIXES = ['🚨 Deployment Failure:', '🔍 Unknown Deployment Failure']

/** Is this task one the deployment monitor created? */
export function isDeploymentMonitorTask(task: MonitorTaskLike): boolean {
  const description = task.description ?? ''
  if (description.includes(DEPLOY_MONITOR_TAG)) return true

  // Pre-tag tasks: the description heading AND an exact title prefix. Either
  // alone is too weak — a human can write the heading into a note, and a title
  // prefix alone was the original bug in a stricter costume.
  const title = (task.title ?? '').trim()
  return (
    description.includes(LEGACY_DESCRIPTION_MARKER) &&
    LEGACY_TITLE_PREFIXES.some(prefix => title.startsWith(prefix))
  )
}

/**
 * The fingerprint tying a task to a specific deployment, so completion is never
 * a guess about a task that merely looks related.
 */
export function deploymentFingerprint(deploymentUrl: string): string {
  return `${DEPLOY_MONITOR_TAG} deployment=${deploymentUrl}`
}

/** Does this task record a specific deployment? */
export function hasDeploymentFingerprint(task: MonitorTaskLike): boolean {
  const description = task.description ?? ''
  return description.includes(`${DEPLOY_MONITOR_TAG} deployment=`) ||
    description.includes('**Deployment**:')
}

/**
 * The tasks a healthy-deployments run may comment on and complete.
 *
 * Both conditions are required. Completion is destructive and irreversible from
 * a script's point of view, so "probably one of mine" is not good enough.
 */
export function selectResolvableTasks<T extends MonitorTaskLike>(tasks: T[]): T[] {
  return tasks.filter(
    task => !task.completed && isDeploymentMonitorTask(task) && hasDeploymentFingerprint(task),
  )
}
