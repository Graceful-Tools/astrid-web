"use client"

/**
 * The board's custom columns, read from `Project.customStates` (task b346e377).
 *
 * WHY A FETCH RATHER THAN THE LIST PAYLOAD. The board receives `lists` and
 * nothing else — there is no client-side project state anywhere in the app.
 * The alternative was to hang the project's states off every list payload, but
 * the list include is inlined at roughly a dozen route files, so that is a
 * wide sweep of the hottest path in the app to deliver one field the board
 * alone consumes. One cached request is the smaller change.
 *
 * WHILE THE REQUEST IS IN FLIGHT this returns `undefined`, and the board
 * renders its legacy list-backed columns until the states land.
 *
 * `undefined` and `[]` are the SAME input to `getProjectBoardColumns`:
 * `parseCustomStates` returns `[]` for any non-array (lib/task-status.ts), so
 * both render the legacy row-backed columns and no stored ones. An earlier
 * version of this comment claimed `[]` would "blink the columns out on every
 * load" and that `undefined` avoided it — it does not, and there is nothing to
 * avoid. Nothing downstream distinguishes the two today; if that ever changes,
 * change it deliberately rather than relying on which one this returns.
 */

import { useEffect, useState } from 'react'

/** Cached across mounts: switching boards must not refetch every time. */
const cache = new Map<string, unknown>()
const inflight = new Map<string, Promise<unknown>>()

async function fetchCustomStates(projectId: string): Promise<unknown> {
  const response = await fetch('/api/v1/projects')
  if (!response.ok) throw new Error(`projects ${response.status}`)

  const body = await response.json()
  const projects: Array<{ id?: string; customStates?: unknown }> = Array.isArray(body?.projects)
    ? body.projects
    : []

  return projects.find(project => project.id === projectId)?.customStates ?? []
}

export function useProjectCustomStates(projectId: string | null | undefined): unknown {
  const [states, setStates] = useState<unknown>(() =>
    projectId ? cache.get(projectId) : undefined,
  )

  useEffect(() => {
    if (!projectId) {
      setStates(undefined)
      return
    }

    if (cache.has(projectId)) {
      setStates(cache.get(projectId))
      return
    }

    let active = true
    // Deduplicated: two boards mounting at once must not issue two requests.
    let request = inflight.get(projectId)
    if (!request) {
      request = fetchCustomStates(projectId).finally(() => inflight.delete(projectId))
      inflight.set(projectId, request)
    }

    request
      .then(value => {
        cache.set(projectId, value)
        if (active) setStates(value)
      })
      .catch(() => {
        // A failed read must not blank the board's custom columns. Staying
        // undefined keeps the legacy list-backed rendering.
        if (active) setStates(undefined)
      })

    return () => {
      active = false
    }
  }, [projectId])

  return states
}

/** Test seam: the module-level cache would otherwise leak between cases. */
export function __clearProjectCustomStatesCache() {
  cache.clear()
  inflight.clear()
}
