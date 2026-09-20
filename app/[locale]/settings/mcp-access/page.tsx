"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { LoadingScreen } from "@/components/loading-screen"

/**
 * Legacy MCP Access Page - Redirects to API Access
 *
 * This page has been renamed from "MCP Access" to "API Access"
 * to better reflect its purpose as the Astrid API management interface.
 */
export default function LegacyMCPAccessPage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to new API Access page
    router.replace('/settings/connections')
  }, [router])

  return (
    <LoadingScreen message="Redirecting to Connections..." />
  )
}
