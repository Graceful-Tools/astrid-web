"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { LoadingScreen } from "@/components/loading-screen"

export default function ChatGPTSettingsRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/settings/connections")
  }, [router])

  return <LoadingScreen message="Redirecting to Connections..." />
}
