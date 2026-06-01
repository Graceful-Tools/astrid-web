import { useCallback, useEffect, useState } from "react"
import type { TaskList } from "@/types/task"

/**
 * A project as returned by GET /api/projects (listProjectsForUser shape):
 * metadata + the embedded board lists (domain lists + shared status columns).
 */
export interface ProjectSummary {
  id: string
  name: string
  description?: string | null
  color?: string | null
  imageUrl?: string | null
  ownerId: string
  lists: TaskList[]
}

interface UseProjectsResult {
  projects: ProjectSummary[]
  loading: boolean
  error: string | null
  /** Re-fetch the project list (e.g. after creating/editing one). */
  refresh: () => void
}

/**
 * Fetches the current user's projects (owned or member-of) for the sidebar
 * picker (board sub-task #1). Surfaces the existing GET /api/projects, which
 * had no UI consumer before.
 */
export function useProjects(enabled = true): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!cancelled) setProjects(Array.isArray(data.projects) ? data.projects : [])
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "Failed to load projects")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, reloadKey])

  return { projects, loading, error, refresh }
}

/**
 * The list a project picker should select to open a project's board: the
 * project's first non-status (domain) list. Returns null if the project has
 * no domain list yet (only the shared status columns).
 */
export function getProjectPrimaryListId(project: ProjectSummary): string | null {
  const domain = project.lists.find(
    (list) => list.listType !== "status" && list.projectId === project.id,
  )
  return domain?.id ?? null
}
