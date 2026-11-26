"use client"

import { useEffect, useState } from "react"
import { loadBrowserCoreRules } from "@/lib/core-rules/browser"
import { TaskManager } from "@/components/TaskManager"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { offlineDB } from "@/lib/offline-db"

interface AuthenticatedAppProps {
  initialSelectedListId?: string
  initialSelectedTaskId?: string
  initialSettingsPage?: string
  listMetadata?: any
  taskMetadata?: any
}

export function AuthenticatedApp({
  initialSelectedListId,
  initialSelectedTaskId,
  initialSettingsPage,
  listMetadata,
  taskMetadata
}: AuthenticatedAppProps = {}) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [doorReady, setDoorReady] = useState(false)
  useEffect(() => { void loadBrowserCoreRules().then(() => new Promise((r) => setTimeout(r, 400))).finally(() => setDoorReady(true)) }, [])

  // Clear cached server data on page load to force a fresh fetch. Not while
  // offline: the cache is all the app has then (AWTD-1417).
  //
  // TaskManager mounts only once this has finished (ADEV-322). It reads its sync cursors and
  // cached rows when it mounts, so a clear that landed after that left a cursor with no rows
  // behind it: a delta sync from the cursor and an empty list on screen.
  const [cacheCleared, setCacheCleared] = useState(false)
  useEffect(() => {
    const clearIndexedDBOnLoad = async () => {
      if (!navigator.onLine) return
      try {
        await offlineDB.forceRefresh()
        if (process.env.NODE_ENV === "development") {
          console.log("[IndexedDB] Cache cleared on page load")
        }
      } catch (error) {
        console.error("[IndexedDB] Error clearing cache on load:", error)
      }
    }

    void clearIndexedDBOnLoad().finally(() => setCacheCleared(true))
  }, []) // Run once on mount

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/auth/signin")
    }
  }, [status, router])

  if (status === "loading" || !session || !doorReady || !cacheCleared) {
    // App shell skeleton — matches real layout so transition is smooth
    return (
      <div className="min-h-screen theme-bg-primary flex">
        <div className="w-64 border-r theme-border hidden md:block p-4">
          <div className="h-8 w-32 bg-theme-tertiary rounded animate-pulse mb-6" />
          <div className="space-y-3">
            <div className="h-6 w-full bg-theme-tertiary rounded animate-pulse" />
            <div className="h-6 w-3/4 bg-theme-tertiary rounded animate-pulse" />
            <div className="h-6 w-5/6 bg-theme-tertiary rounded animate-pulse" />
          </div>
        </div>
        <div className="flex-1 p-6">
          <div className="h-8 w-48 bg-theme-tertiary rounded animate-pulse mb-6" />
          <div className="space-y-4">
            <div className="h-12 w-full bg-theme-tertiary rounded animate-pulse" />
            <div className="h-12 w-full bg-theme-tertiary rounded animate-pulse" />
            <div className="h-12 w-3/4 bg-theme-tertiary rounded animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  // Removed excessive logging - only log on mount, not every render
  return (
    <TaskManager
      initialSelectedListId={initialSelectedListId}
      initialSelectedTaskId={initialSelectedTaskId}
      initialSettingsPage={initialSettingsPage}
      listMetadata={listMetadata}
      taskMetadata={taskMetadata}
    />
  )
}
