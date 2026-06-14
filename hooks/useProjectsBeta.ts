"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * Reads / toggles the per-user "Projects (Beta)" opt-in, backed by
 * /api/user/settings (projectsBetaEnabled). Gates the Projects UI surfaces
 * (sidebar section, Create-Board, board sharing). Server routes independently
 * enforce the same flag for create / share writes.
 */
export function useProjectsBeta() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch("/api/user/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setEnabled(!!data.projectsBetaEnabled)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const update = useCallback(async (next: boolean) => {
    setEnabled(next) // optimistic
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectsBetaEnabled: next }),
      })
      if (!res.ok) throw new Error("Failed to update setting")
      const data = await res.json().catch(() => null)
      if (data && typeof data.projectsBetaEnabled === "boolean") {
        setEnabled(data.projectsBetaEnabled)
      }
    } catch {
      setEnabled(!next) // rollback
    }
  }, [])

  return { enabled, loading, setEnabled: update }
}
