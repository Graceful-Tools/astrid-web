"use client"

/**
 * A project's decisions on the client (ADEV-188, the UI half of ADEV-180), read from
 * GET /api/v1/projects/:id/decisions. `create` starts one from the project's goals (POST) and
 * `decide` records a choice (POST …/decide); both reload the list. One cached read per project,
 * shared by everything on the board that shows it, as `use-project-goals` does.
 */
import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import type { ChosenOption } from '@/lib/decision-grid'

/** One row of GET …/decisions (services/project-decisions.service.ts → ProjectDecisionView). */
export interface ProjectDecision {
  id: string
  identifier: string | null
  title: string
  prompt: string
  options: Array<{ number: number; text: string; recommended: boolean }>
  status: 'open' | 'decided'
  chosen: ChosenOption | null
  assigneeId: string | null
  createdAt: string
}

const cache = new Map<string, ProjectDecision[]>()
const inflight = new Map<string, Promise<ProjectDecision[]>>()
const listeners = new Map<string, Set<(decisions: ProjectDecision[]) => void>>()

const base = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/decisions`

function publish(projectId: string, decisions: ProjectDecision[]) {
  cache.set(projectId, decisions)
  listeners.get(projectId)?.forEach(listener => listener(decisions))
}

async function fetchDecisions(projectId: string): Promise<ProjectDecision[]> {
  const response = await apiGet(base(projectId))
  const body = (await response.json()) as { decisions?: unknown }
  return Array.isArray(body?.decisions) ? (body.decisions as ProjectDecision[]) : []
}

/** Read the list again and tell every board showing it. */
export async function reloadProjectDecisions(projectId: string): Promise<ProjectDecision[]> {
  const decisions = await fetchDecisions(projectId)
  publish(projectId, decisions)
  return decisions
}

/** Start a decision from the project's goals; resolves to the new task's id. */
export async function createProjectDecision(projectId: string, title?: string): Promise<string> {
  const response = await apiPost(base(projectId), title ? { title } : {})
  const body = (await response.json()) as { task?: { id?: unknown } }
  const id = body?.task?.id
  if (typeof id !== 'string') throw new Error('No task in the reply')
  void reloadProjectDecisions(projectId).catch(() => {})
  return id
}

/** Record the option chosen (its number, as the cards show it). */
export async function decideProjectDecision(projectId: string, taskId: string, option: number): Promise<void> {
  await apiPost(`${base(projectId)}/${encodeURIComponent(taskId)}/decide`, { option })
  await reloadProjectDecisions(projectId).catch(() => {})
}

/** `undefined` while loading, and when the read fails. */
export function useProjectDecisions(projectId: string | null | undefined): {
  decisions: ProjectDecision[] | undefined
  create: (title?: string) => Promise<string>
  decide: (taskId: string, option: number) => Promise<void>
  reload: () => Promise<ProjectDecision[]>
} {
  const [decisions, setDecisions] = useState<ProjectDecision[] | undefined>(() => (projectId ? cache.get(projectId) : undefined))

  useEffect(() => {
    if (!projectId) {
      setDecisions(undefined)
      return
    }
    let active = true
    const listener = (next: ProjectDecision[]) => { if (active) setDecisions(next) }
    const set = listeners.get(projectId) ?? new Set()
    set.add(listener)
    listeners.set(projectId, set)

    if (cache.has(projectId)) {
      setDecisions(cache.get(projectId))
    } else {
      let request = inflight.get(projectId)
      if (!request) {
        request = fetchDecisions(projectId).finally(() => inflight.delete(projectId))
        inflight.set(projectId, request)
      }
      request.then(next => { if (active) publish(projectId, next) }).catch(() => { if (active) setDecisions(undefined) })
    }
    return () => {
      active = false
      set.delete(listener)
    }
  }, [projectId])

  const create = useCallback(
    (title?: string) => (projectId ? createProjectDecision(projectId, title) : Promise.reject(new Error('No project'))),
    [projectId],
  )
  const decide = useCallback(
    (taskId: string, option: number) => (projectId ? decideProjectDecision(projectId, taskId, option) : Promise.reject(new Error('No project'))),
    [projectId],
  )
  const reload = useCallback(
    () => (projectId ? reloadProjectDecisions(projectId) : Promise.resolve([])),
    [projectId],
  )

  return { decisions, create, decide, reload }
}

/** Tests only. */
export function __clearProjectDecisionsCache() {
  cache.clear()
  inflight.clear()
  listeners.clear()
}
