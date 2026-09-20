"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { LoadingScreen } from "@/components/loading-screen"

/**
 * Retired: API Access became Connections.
 *
 * The page was a developer console for creating OAuth apps, which most
 * readers never needed. Connections is the audit list of everything that can
 * act as the account, with that console folded underneath it.
 */
export default function LegacyApiAccessPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/settings/connections')
  }, [router])

  return <LoadingScreen message="Redirecting to Connections..." />
}
