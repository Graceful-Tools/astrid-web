import { useEffect, useSyncExternalStore } from 'react'
import {
  browserListPermissionsState,
  loadBrowserCoreRules,
  scheduleBrowserCoreRules,
  subscribeBrowserListPermissions,
  type ListPermissionsState,
} from '@/lib/core-rules/browser'

/** Load astrid-core's browser door once the page is idle after first paint (AWTD-1586). */
export function useBrowserCoreRules(): void {
  useEffect(() => scheduleBrowserCoreRules(), [])
}

const pendingOnServer = (): ListPermissionsState => 'pending'

/**
 * Start loading astrid-core's browser door NOW and report whether list permissions can be answered
 * (ADEV-304). There is no TypeScript permission rule, so until this says `ready` every permission
 * check is refused: a page that draws permission affordances shows its loading state while this
 * is `pending`, rather than a refusal that only means "not loaded yet". `pending` on the server
 * and on the first client render, so hydration matches.
 */
export function useListPermissionsState(): ListPermissionsState {
  useEffect(() => {
    void loadBrowserCoreRules()
  }, [])
  return useSyncExternalStore(subscribeBrowserListPermissions, browserListPermissionsState, pendingOnServer)
}
