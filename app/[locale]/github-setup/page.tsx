"use client"

/**
 * Retired: a 460-line static setup guide with hardcoded (fake) status
 * indicators. The live GitHub setup is on the agents settings page; the
 * install callback lands at /settings/agents/github-setup.
 *
 * A query-preserving redirect rather than a deletion, because this URL may be
 * configured as the GitHub App's Setup URL — the ?installation_id=… landing
 * must keep working.
 */
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { LoadingScreen } from "@/components/loading-screen"

export default function LegacyGitHubSetupPage() {
  const router = useRouter()

  useEffect(() => {
    const search = typeof window !== 'undefined' ? window.location.search : ''
    router.replace(`/settings/agents/github-setup${search}`)
  }, [router])

  return <LoadingScreen message="Redirecting to GitHub setup..." />
}
