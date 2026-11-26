/**
 * The client's permission affordances (what the UI offers: edit, delete, manage members) ask
 * core `listAccess` once the browser door has loaded (ADEV-90), through the same decider the
 * server installs; the TypeScript in lib/list-permissions.ts stays the fallback (the comparison was
 * retired with the server's, AWTD-1608). A build that does not list `listAccess` installs nothing.
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
      failure: (details) => log.error(details, 'list permissions: astrid-core could not answer; the TypeScript answer was used'),
    },
    { mode: 'decide' },
  )
  setListPermissionsCore(decider.decide)
  return true
}
