"use client"

/**
 * A boolean remembered per browser, shared by every component that reads it —
 * the store behind the sidebar's and the messages pane's open/close toggles
 * (AWTD-1163, AWTD-1178).
 *
 * A tiny external store rather than props: the pane and its toggle read it
 * directly, so nothing threads through TaskManagerView. Remembered in
 * localStorage, where every access is guarded — a private window or blocked
 * storage throws, and the toggle must still work for the session.
 */

import { useSyncExternalStore } from "react"

export interface PersistedFlagStore {
  set: (next: boolean) => void
  /** [value, toggle]. Always false on the server, so markup matches until hydration. */
  useFlag: () => [boolean, () => void]
}

export function createPersistedFlagStore(storageKey: string): PersistedFlagStore {
  const listeners = new Set<() => void>()
  let value: boolean | null = null

  function read(): boolean {
    if (value === null) {
      try {
        value = window.localStorage.getItem(storageKey) === "1"
      } catch {
        value = false
      }
    }
    return value
  }

  function set(next: boolean): void {
    value = next
    try {
      window.localStorage.setItem(storageKey, next ? "1" : "0")
    } catch {
      // Remembered for this session only.
    }
    listeners.forEach(listener => listener())
  }

  function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function useFlag(): [boolean, () => void] {
    const current = useSyncExternalStore(subscribe, read, () => false)
    return [current, () => set(!read())]
  }

  return { set, useFlag }
}
