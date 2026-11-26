"use client"

import { useEffect, useState } from 'react'
import { apiGet } from '@/lib/api'
import type { OrchestrationPolicy } from '@/lib/orchestration-policy'

/**
 * Does a trade-off policy apply to this list (ADEV-281)? That is the one question the Policy sort and
 * the label chips ask: with none stated nothing is labelled and there is no sort option.
 *
 * Read from the list's effective orchestration policy, which the server resolves through the core
 * (the browser carries no core build for these rules). False until the answer arrives and on any
 * failure, so a surface that depends on it stays hidden rather than flickering in.
 */
export function useListTradeoffPolicyStated(listId: string | null | undefined): boolean {
  const [stated, setStated] = useState(false)

  useEffect(() => {
    setStated(false)
    if (!listId) return
    let live = true
    apiGet(`/api/v1/lists/${encodeURIComponent(listId)}/orchestration-policy`)
      .then(response => response.json())
      .then((view: { effective?: Partial<OrchestrationPolicy> } | null) => {
        if (live) setStated(!!view?.effective?.tradeoff)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [listId])

  return stated
}
