"use client"

/**
 * A task's experiment links on the client (ADEV-282), read from `GET /api/v1/tasks/:id/experiment`.
 * One cached read per task, shared by the experiment row and the Pending results card, so a link or
 * a Refresh in one updates the other. `undefined` while loading and when the read fails (the gate off,
 * a 404): the surfaces draw nothing rather than an error.
 */
import { useCallback, useEffect, useState } from 'react'
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import type { TaskExperimentsState } from '@/lib/task-experiment-client'

const cache = new Map<string, TaskExperimentsState>()
const inflight = new Map<string, Promise<TaskExperimentsState | undefined>>()
const listeners = new Map<string, Set<(state: TaskExperimentsState) => void>>()

const base = (taskId: string) => `/api/v1/tasks/${encodeURIComponent(taskId)}/experiment`

function toState(body: unknown): TaskExperimentsState {
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  return {
    experiments: Array.isArray(record.experiments) ? (record.experiments as TaskExperimentsState['experiments']) : [],
    inResultsColumn: record.inResultsColumn === true,
  }
}

function publish(taskId: string, state: TaskExperimentsState) {
  cache.set(taskId, state)
  listeners.get(taskId)?.forEach(listener => listener(state))
}

function read(taskId: string): Promise<TaskExperimentsState | undefined> {
  const cached = cache.get(taskId)
  if (cached) return Promise.resolve(cached)
  let pending = inflight.get(taskId)
  if (!pending) {
    pending = apiGet(base(taskId))
      .then(response => response.json())
      .then(body => {
        const state = toState(body)
        publish(taskId, state)
        return state
      })
      .catch(() => undefined)
      .finally(() => inflight.delete(taskId))
    inflight.set(taskId, pending)
  }
  return pending
}

/** Drop the cached read and reread, telling every listener. */
async function reload(taskId: string): Promise<void> {
  cache.delete(taskId)
  await read(taskId)
}

/** Link an experiment or start a verification, then reread. Rejects with the server's refusal. */
export async function linkTaskExperiment(taskId: string, body: Record<string, unknown>): Promise<void> {
  await apiPost(base(taskId), body)
  await reload(taskId)
}

/** Forget the cache (tests, and a sign-out). */
export function resetTaskExperimentsCache() {
  cache.clear()
  inflight.clear()
}

export function useTaskExperiments(taskId: string | null | undefined, enabled = true) {
  const [state, setState] = useState<TaskExperimentsState | undefined>(() => (taskId ? cache.get(taskId) : undefined))

  useEffect(() => {
    if (!taskId || !enabled) {
      setState(undefined)
      return
    }
    let active = true
    setState(cache.get(taskId))
    const set = listeners.get(taskId) ?? new Set()
    listeners.set(taskId, set)
    const listener = (next: TaskExperimentsState) => {
      if (active) setState(next)
    }
    set.add(listener)
    void read(taskId).then(next => {
      if (active && next) setState(next)
    })
    return () => {
      active = false
      set.delete(listener)
    }
  }, [taskId, enabled])

  /** Read every open link now. The lane may complete or hand back the task; the caller reloads for that. */
  const refresh = useCallback(async () => {
    if (!taskId) return
    const response = await apiPost(`${base(taskId)}/refresh`, {})
    publish(taskId, toState(await response.json()))
  }, [taskId])

  const unlink = useCallback(
    async (experimentId: string) => {
      if (!taskId) return
      await apiDelete(`${base(taskId)}?experimentId=${encodeURIComponent(experimentId)}`)
      await reload(taskId)
    },
    [taskId],
  )

  return { state, refresh, unlink }
}
