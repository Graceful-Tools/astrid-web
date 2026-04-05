"use client"

export const dynamic = 'force-dynamic'

import { Suspense } from "react"
import { AuthenticatedApp } from "@/components/authenticated-app"
import { LoadingScreen } from "@/components/loading-screen"

export default function AppearanceSettingsPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AuthenticatedApp initialSettingsPage="appearance" />
    </Suspense>
  )
}
