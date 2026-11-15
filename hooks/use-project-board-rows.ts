"use client"

/**
 * One person's chosen rows for one project board (AWTD-1660), read from and
 * saved to `GET/PUT /api/v1/projects/:id/board-rows` so the choice follows
 * them across devices.
 *
 * Saves are optimistic: the board redraws at once and goes back to what it
 * had if the write fails, with `saveFailed` set so the board can say so.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPut } from '@/lib/api'

export interface ProjectBoardRowsState {
  /** null = nothing saved, draw the project's own lists. */
  listIds: string[] | null
  loaded: boolean
  saveFailed: boolean
  save: (next: string[]) => Promise<void>
}

const endpoint = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/board-rows`

export function useProjectBoardRows(projectId: string): ProjectBoardRowsState {
  const [listIds, setListIds] = useState<string[] | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const current = useRef<string[] | null>(null)
  current.current = listIds

  useEffect(() => {
    let active = true
    setLoaded(false)
    setListIds(null)
    apiGet(endpoint(projectId))
      .then(response => response.json())
      .then(body => {
        if (!active) return
        setListIds(Array.isArray(body?.listIds) ? body.listIds : null)
      })
      .catch(() => {
        // A failed read draws the default rows rather than nothing.
      })
      .finally(() => {
        if (active) setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [projectId])

  const save = useCallback(async (next: string[]) => {
    const previous = current.current
    setListIds(next)
    setSaveFailed(false)
    try {
      await apiPut(endpoint(projectId), { listIds: next })
    } catch {
      setListIds(previous)
      setSaveFailed(true)
    }
  }, [projectId])

  return { listIds, loaded, saveFailed, save }
}
