"use client"

import { useEffect, useState } from 'react'
import { apiGet } from '@/lib/api'
import type { TaskEstimateSummary } from '@/types/task'

/**
 * Every task's stored trade-off label and sort key on one list (ADEV-281), for the `policy` sort and
 * the label chips.
 *
 * The bulk task sync omits `estimate`: it is opt-in on the list route (`?include=estimate`,
 * lib/tasks/v1-task-estimate.ts) for the payload budget, so a view that sorts by policy fetches them
 * separately, as board filters do for project fields (hooks/use-project-field-values.ts). Only while
 * `listId` is given; pass `null` and nothing is requested.
 *
 * Returns `null` until the keys arrive, so the caller can tell "not loaded" from "no task has one". A
 * failed read stays `null`: the list sorts as auto rather than showing as empty.
 */
export function usePolicyEstimates(listId: string | null): ReadonlyMap<string, TaskEstimateSummary> | null {
  const [estimates, setEstimates] = useState<ReadonlyMap<string, TaskEstimateSummary> | null>(null)

  useEffect(() => {
    setEstimates(null)
    if (!listId) return

    let live = true
    const params = new URLSearchParams({
      listId,
      include: 'estimate',
      omit: 'description,listMembers',
      limit: '1000',
    })
    apiGet(`/api/v1/tasks?${params}`)
      .then(response => response.json())
      .then((body: { tasks?: Array<{ id: string; estimate?: TaskEstimateSummary }> }) => {
        if (!live) return
        const map = new Map<string, TaskEstimateSummary>()
        for (const task of body.tasks ?? []) {
          if (task.estimate) map.set(task.id, task.estimate)
        }
        setEstimates(map)
      })
      .catch(() => {})

    return () => {
      live = false
    }
  }, [listId])

  return estimates
}
