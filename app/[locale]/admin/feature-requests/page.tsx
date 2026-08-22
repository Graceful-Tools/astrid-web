import { redirect } from 'next/navigation'

/**
 * The access-request queue moved to /admin/features/[key]/requests when it
 * became per-feature (task 3cef96ef).
 *
 * This page exists only so the old URL does not 404. It was the ONLY route to
 * the queue for months and is a plausible bookmark; deleting the folder outright
 * turned that bookmark into a dead end, which is a worse outcome than one
 * redirect file.
 *
 * It points at the index rather than at project_mode — the feature it used to
 * be hardcoded to — because the whole point of the change is that the queue
 * belongs to a feature you choose, and silently picking one again would be the
 * bug this task was filed about.
 */
export default function LegacyFeatureRequestsRedirect() {
  redirect('/admin/features')
}
