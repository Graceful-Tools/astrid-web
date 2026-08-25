"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { LoadingScreen } from "@/components/loading-screen"

/**
 * Retired: Cloud Agents folded into the single AI Agents page.
 *
 * The self-hosted SDK, webhook, and GitHub App sections live there now under
 * "Advanced: self-hosted agents & webhooks". Query params are preserved because
 * the GitHub App install flow used to land here with ?github=... status.
 */
export default function LegacyCodingAgentsPage() {
  const router = useRouter()

  useEffect(() => {
    const search = typeof window !== 'undefined' ? window.location.search : ''
    router.replace(`/settings/agents${search}`)
  }, [router])

  return <LoadingScreen message="Redirecting to AI Agents..." />
}
