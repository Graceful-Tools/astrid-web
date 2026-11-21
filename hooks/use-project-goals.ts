"use client"

import { useCallback, useEffect, useState } from "react"
import { apiGet, apiPut, refusalReason } from "@/lib/api"
import { readStoredGoals, type GoalsAndGuardrails } from "@/lib/goals-guardrails"

/**
 * A project's goals and guardrails (ADEV-179), from GET /api/v1/projects/:id/goals.
 *
 * `goals` is null while loading, when the project states none, and when the read fails: the board
 * strip and the settings editor both treat "nothing to show" the same way. `setGoals` lets the
 * editor hand back what it saved, so the strip follows without a second read.
 */
export function useProjectGoals(projectId: string) {
  const [goals, setGoals] = useState<GoalsAndGuardrails | null>(null)

  useEffect(() => {
    let cancelled = false
    setGoals(null)
    apiGet(`/api/v1/projects/${encodeURIComponent(projectId)}/goals`)
      .then(response => response.json())
      .then(data => { if (!cancelled && data) setGoals(readStoredGoals(data.goals)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectId])

  const save = useCallback(
    async (next: GoalsAndGuardrails | null): Promise<{ ok: true } | { ok: false; error: string | null }> => {
      try {
        const response = await apiPut(`/api/v1/projects/${encodeURIComponent(projectId)}/goals`, { goals: next })
        const data = await response.json()
        setGoals(readStoredGoals(data.goals))
        return { ok: true }
      } catch (error) {
        // A refusal carries the server's reason (a 400 says which field); anything else has none.
        return { ok: false, error: refusalReason(error) }
      }
    },
    [projectId],
  )

  return { goals, save }
}
