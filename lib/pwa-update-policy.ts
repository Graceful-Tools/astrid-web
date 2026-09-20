/**
 * Whether a service-worker `controllerchange` should reload the page.
 *
 * Only an UPDATE warrants it: a new worker replaced the one that was already
 * controlling the page, so the page should run the new code. The first worker
 * claiming a page that had no controller (`clients.claim()` on install) is not
 * an update — reloading there restarts every first visit a second after load.
 * `hasReloaded` keeps it to one reload per page even if the event repeats.
 */
export function shouldReloadForControllerChange({
  hasReloaded,
  hadController,
}: {
  hasReloaded: boolean
  hadController: boolean
}): boolean {
  return hadController && !hasReloaded
}
