"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { LoadingScreen } from "@/components/loading-screen"

/**
 * Retired: this page declared itself deprecated for months and every section
 * existed elsewhere. The agent story lives on the single AI Agents page.
 */
export default function LegacyCodingIntegrationPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/settings/agents')
  }, [router])

  return <LoadingScreen message="Redirecting to AI Agents..." />
}
