"use client"

/**
 * Whether the desktop messages pane is hidden (AWTD-1178) — the sidebar's
 * toggle, mirrored on the right. See persisted-flag-store.ts.
 */

import { createPersistedFlagStore } from "./persisted-flag-store"

export const CHAT_PANE_COLLAPSED_KEY = "astrid.chatPaneCollapsed"

const store = createPersistedFlagStore(CHAT_PANE_COLLAPSED_KEY)

export const setChatPaneCollapsed = store.set

/** [collapsed, toggle]. Always shown on the server, so markup matches until hydration. */
export const useChatPaneCollapsed = store.useFlag
