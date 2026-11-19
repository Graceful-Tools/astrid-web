"use client"

import React from "react"
import {
  DEFAULT_DONE_SINCE,
  doneSinceStorageKey,
  parseDoneSince,
  type DoneSince,
} from "@/lib/board-done-since"

/**
 * The Done column's period for one list, saved per user and per list on this
 * device (ADEV-133). Starts at This week, then adopts the saved value once the
 * client has mounted, so server and first client render agree.
 */
export function useDoneSince(userId: string | null | undefined, listId: string): [DoneSince, (next: DoneSince) => void] {
  const key = doneSinceStorageKey(userId, listId)
  const [since, setSince] = React.useState<DoneSince>(DEFAULT_DONE_SINCE)

  React.useEffect(() => {
    try {
      setSince(parseDoneSince(window.localStorage.getItem(key)))
    } catch {
      setSince(DEFAULT_DONE_SINCE)
    }
  }, [key])

  const update = React.useCallback((next: DoneSince) => {
    setSince(next)
    try {
      window.localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // Private mode or a full quota: the choice still holds for this session.
    }
  }, [key])

  return [since, update]
}
