/**
 * The client's permission affordances (what the UI offers: edit, delete, manage members) ask
 * core `listAccess` once the browser door has loaded (ADEV-90), through the same decider the
 * server installs. Since ADEV-304 there is no TypeScript rule behind it: until this is installed,
 * or if the build does not list `listAccess`, every check is refused, which is why the app shell
 * waits for the door (components/core-rules-gate.tsx) before drawing anything.
 *
 * Its own module so ./browser.ts can import it lazily, after first paint: the decider is not
 * part of any route's first-load JS.
 */
import { setListPermissionsCore } from '@/lib/list-permissions'
import { createLogger } from '@/lib/logger'
import { createListPermissionsCore } from './list-permissions-decider'

export function installBrowserListPermissions(door: {
  runJson(request: string): string
  answers(kind: string): boolean
}): boolean {
  if (!door.answers('listAccess')) return false
  const log = createLogger('core-rules-browser')
  const decider = createListPermissionsCore(
    door.runJson,
    {
      failure: (details) => log.error(details, 'list permissions: astrid-core could not answer; the check was refused'),
    },
    { mode: 'decide' },
  )
  setListPermissionsCore(decider.decide)
  return true
}
