"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { LoadingScreen } from "@/components/loading-screen"

export default function WebhookSettingsRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/settings/agents")
  }, [router])

  return <LoadingScreen message="Redirecting to Coding Agents..." />
}
