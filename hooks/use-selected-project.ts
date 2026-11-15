"use client"

/**
 * Which project board is open, if any (AWTD-1660). Shared by the sidebar's
 * Projects section, which opens one, and the task view, which draws it in
 * place of the list.
 *
 * Kept in the URL as `?project=<id>` so a reload reopens the board; picking a
 * list or My Tasks closes it.
 */
import { useSyncExternalStore } from 'react'

const PARAM = 'project'
const listeners = new Set<() => void>()
let selected: string | null | undefined

function read(): string | null {
  if (selected === undefined) {
    selected = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(PARAM)
  }
  return selected
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setSelectedProjectId(projectId: string | null) {
  if (read() === projectId) return
  selected = projectId
  if (typeof window !== 'undefined' && projectId) {
    window.history.replaceState(null, '', `/?${PARAM}=${encodeURIComponent(projectId)}`)
  }
  for (const listener of listeners) listener()
}

export function useSelectedProjectId(): string | null {
  return useSyncExternalStore(subscribe, read, () => null)
}

/** Test seam: the module-level selection would otherwise leak between cases. */
export function __resetSelectedProject() {
  selected = undefined
  listeners.clear()
}
