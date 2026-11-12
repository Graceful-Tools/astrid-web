"use client"

/**
 * The reader's projects (boards), read once per page load through
 * `loadProjectsOnce` and shared with every other caller of it. Empty until the
 * read lands, and on a failed read — callers treat "no projects known" as the
 * state they render before projects existed.
 */
import { useEffect, useState } from 'react'
import { loadProjectsOnce, peekLoadedProjects, type ClientProject } from '@/lib/client-projects'

const NONE: ClientProject[] = []

export function useLoadedProjects(): ClientProject[] {
  const [projects, setProjects] = useState<ClientProject[]>(() => peekLoadedProjects() ?? NONE)

  useEffect(() => {
    let active = true
    loadProjectsOnce()
      .then(result => {
        if (active) setProjects(result)
      })
      .catch(() => {
        // An enhancement; a failed read keeps what we had.
      })
    return () => {
      active = false
    }
  }, [])

  return projects
}
