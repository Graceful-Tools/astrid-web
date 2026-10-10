"use client"

/**
 * Whether the desktop sidebar is collapsed (AWTD-1163) — a per-browser
 * convenience, like Mac's sidebar toggle.
 *
 * A tiny external store rather than props: the sidebar and its toggle read it
 * directly, so nothing threads through TaskManagerView. Remembered in
 * localStorage, where every access is guarded — a private window or blocked
 * storage throws, and the toggle must still work for the session.
 */

import { useSyncExternalStore } from "react"

export const SIDEBAR_COLLAPSED_KEY = "astrid.sidebarCollapsed"

const listeners = new Set<() => void>()
let collapsed: boolean | null = null

function read(): boolean {
  if (collapsed === null) {
    try {
      collapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
    } catch {
      collapsed = false
    }
  }
  return collapsed
}

export function setSidebarCollapsed(next: boolean): void {
  collapsed = next
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0")
  } catch {
    // Remembered for this session only.
  }
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** [collapsed, toggle]. Always expanded on the server, so markup matches until hydration. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const value = useSyncExternalStore(subscribe, read, () => false)
  return [value, () => setSidebarCollapsed(!read())]
}
