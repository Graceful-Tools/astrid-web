"use client"

/**
 * Whether the desktop sidebar is collapsed (AWTD-1163) — a per-browser
 * convenience, like Mac's sidebar toggle. See persisted-flag-store.ts.
 */

import { createPersistedFlagStore } from "./persisted-flag-store"

export const SIDEBAR_COLLAPSED_KEY = "astrid.sidebarCollapsed"

const store = createPersistedFlagStore(SIDEBAR_COLLAPSED_KEY)

export const setSidebarCollapsed = store.set

/** [collapsed, toggle]. Always expanded on the server, so markup matches until hydration. */
export const useSidebarCollapsed = store.useFlag
