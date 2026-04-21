"use client"

export const dynamic = 'force-dynamic'

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { LoadingScreen } from "@/components/loading-screen"
import { ArrowLeft } from "lucide-react"
import { SettingsPageContent, SETTINGS_PAGE_TITLES } from "@/components/Settings/settings-pages"

export default function SettingsFullPage() {
  const params = useParams()
  const router = useRouter()
  const { status } = useSession()
  const page = (params?.page as string) || ''

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin")
    }
  }, [status, router])

  if (status !== "authenticated") {
    return <LoadingScreen />
  }

  const title = SETTINGS_PAGE_TITLES[page] || page

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b px-6 py-3 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-base font-medium tracking-tight">{title}</h1>
      </div>

      <div className="max-w-3xl mx-auto py-6">
        <SettingsPageContent
          page={page}
          onNavigate={() => {}}
          notFound={<div className="p-8 text-center theme-text-muted">Page not found</div>}
        />
      </div>
    </div>
  )
}
