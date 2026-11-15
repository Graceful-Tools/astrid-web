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
import { peekLoadedProjects, subscribeLoadedProjects } from '@/lib/client-projects'

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
  if (typeof window !== 'undefined') {
    if (projectId) {
      window.history.replaceState(null, '', `/?${PARAM}=${encodeURIComponent(projectId)}`)
    } else if (new URLSearchParams(window.location.search).has(PARAM)) {
      // Closed by something other than a sidebar click (palette, shortcut):
      // drop the param so a reload does not reopen the board (AWTD-1675).
      window.history.replaceState(null, '', '/')
    }
  }
  for (const listener of listeners) listener()
}

export function useSelectedProjectId(): string | null {
  return useSyncExternalStore(subscribe, read, () => null)
}

function subscribeProjects(listener: () => void) {
  return subscribeLoadedProjects(() => listener())
}

/**
 * The open project's name, once its projects have loaded (AWTD-1675). Reads the
 * shared cache without starting a fetch: the board host already loads it, and a
 * header for someone with no project open must cost nothing.
 */
export function useSelectedProjectName(): string | null {
  const projectId = useSelectedProjectId()
  return useSyncExternalStore(
    subscribeProjects,
    () => {
      if (!projectId) return null
      const project = peekLoadedProjects()?.find(candidate => candidate.id === projectId)
      return project ? project.name || project.key || null : null
    },
    () => null,
  )
}

/** Test seam: the module-level selection would otherwise leak between cases. */
export function __resetSelectedProject() {
  selected = undefined
  listeners.clear()
}
