"use client"

/**
 * A project's goals and guardrails on the client (ADEV-179), read from
 * GET /api/v1/projects/:id/goals and saved with PUT. One cached read per project, shared by the board
 * strip and the settings editor, so saving in settings updates the strip without a refetch.
 */
import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPut } from '@/lib/api'
import { storedGoalsAndGuardrails, type GoalsAndGuardrails } from '@/lib/goals-guardrails'

export interface ProjectGoalsState extends GoalsAndGuardrails {
  canEdit: boolean
}

const cache = new Map<string, ProjectGoalsState>()
const inflight = new Map<string, Promise<ProjectGoalsState>>()
const listeners = new Map<string, Set<(state: ProjectGoalsState) => void>>()

function toState(body: unknown): ProjectGoalsState {
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  return { ...storedGoalsAndGuardrails(record), canEdit: record.canEdit === true }
}

function publish(projectId: string, state: ProjectGoalsState) {
  cache.set(projectId, state)
  listeners.get(projectId)?.forEach(listener => listener(state))
}

async function fetchGoals(projectId: string): Promise<ProjectGoalsState> {
  const response = await apiGet(`/api/v1/projects/${encodeURIComponent(projectId)}/goals`)
  return toState(await response.json())
}

/** Replace the project's goals and guardrails; resolves to what the server stored. */
export async function saveProjectGoals(projectId: string, value: GoalsAndGuardrails): Promise<ProjectGoalsState> {
  const response = await apiPut(`/api/v1/projects/${encodeURIComponent(projectId)}/goals`, value)
  const state = toState(await response.json())
  publish(projectId, state)
  return state
}

/** `undefined` while loading, and when the read fails: the board shows nothing rather than an error. */
export function useProjectGoals(projectId: string | null | undefined): {
  state: ProjectGoalsState | undefined
  save: (value: GoalsAndGuardrails) => Promise<ProjectGoalsState>
} {
  const [state, setState] = useState<ProjectGoalsState | undefined>(() => (projectId ? cache.get(projectId) : undefined))

  useEffect(() => {
    if (!projectId) {
      setState(undefined)
      return
    }
    let active = true
    const listener = (next: ProjectGoalsState) => { if (active) setState(next) }
    const set = listeners.get(projectId) ?? new Set()
    set.add(listener)
    listeners.set(projectId, set)

    if (cache.has(projectId)) {
      setState(cache.get(projectId))
    } else {
      let request = inflight.get(projectId)
      if (!request) {
        request = fetchGoals(projectId).finally(() => inflight.delete(projectId))
        inflight.set(projectId, request)
      }
      request.then(next => { if (active) publish(projectId, next) }).catch(() => { if (active) setState(undefined) })
    }
    return () => {
      active = false
      set.delete(listener)
    }
  }, [projectId])

  const save = useCallback(
    (value: GoalsAndGuardrails) => {
      if (!projectId) return Promise.reject(new Error('No project'))
      return saveProjectGoals(projectId, value)
    },
    [projectId],
  )

  return { state, save }
}

/** Tests only. */
export function __clearProjectGoalsCache() {
  cache.clear()
  inflight.clear()
  listeners.clear()
}
