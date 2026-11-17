"use client"

/**
 * Whether a project's lists are hidden in the sidebar (ADEV-61; iOS ADEV-57
 * `SidebarProjectCollapse`). Lists show until hidden, and what was hidden is
 * remembered per browser — the store behind the sidebar's own toggle, one per
 * project. See persisted-flag-store.ts.
 */

import { createPersistedFlagStore, type PersistedFlagStore } from "./persisted-flag-store"

export const SIDEBAR_PROJECT_HIDDEN_KEY_PREFIX = "astrid.sidebarProjectHidden."

const stores = new Map<string, PersistedFlagStore>()

/** [hidden, toggle]. Always shown on the server, so markup matches until hydration. */
export function useSidebarProjectHidden(projectId: string): [boolean, () => void] {
  let store = stores.get(projectId)
  if (!store) {
    store = createPersistedFlagStore(SIDEBAR_PROJECT_HIDDEN_KEY_PREFIX + projectId)
    stores.set(projectId, store)
  }
  return store.useFlag()
}
