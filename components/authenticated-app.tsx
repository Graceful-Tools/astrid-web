"use client"

import { useEffect } from "react"
import { TaskManager } from "@/components/TaskManager"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { offlineDB } from "@/lib/offline-db"

interface AuthenticatedAppProps {
  initialSelectedListId?: string
  initialSelectedTaskId?: string
  listMetadata?: any
  taskMetadata?: any
}

export function AuthenticatedApp({
  initialSelectedListId,
  initialSelectedTaskId,
  listMetadata,
  taskMetadata
}: AuthenticatedAppProps = {}) {
  const { data: session, status } = useSession()
  const router = useRouter()

  // Clear IndexedDB on page load to force fresh data fetch
  useEffect(() => {
    const clearIndexedDBOnLoad = async () => {
      try {
        await offlineDB.forceRefresh()
        if (process.env.NODE_ENV === "development") {
          console.log("[IndexedDB] Cache cleared on page load")
        }
      } catch (error) {
        console.error("[IndexedDB] Error clearing cache on load:", error)
      }
    }

    clearIndexedDBOnLoad()
  }, []) // Run once on mount

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/auth/signin")
    }
  }, [status, router])

  if (status === "loading" || !session) {
    // App shell skeleton — matches real layout so transition is smooth
    return (
      <div className="min-h-screen theme-bg-primary flex">
        <div className="w-64 border-r theme-border hidden md:block p-4">
          <div className="h-8 w-32 bg-gray-800 rounded animate-pulse mb-6" />
          <div className="space-y-3">
            <div className="h-6 w-full bg-gray-800 rounded animate-pulse" />
            <div className="h-6 w-3/4 bg-gray-800 rounded animate-pulse" />
            <div className="h-6 w-5/6 bg-gray-800 rounded animate-pulse" />
          </div>
        </div>
        <div className="flex-1 p-6">
          <div className="h-8 w-48 bg-gray-800 rounded animate-pulse mb-6" />
          <div className="space-y-4">
            <div className="h-12 w-full bg-gray-800 rounded animate-pulse" />
            <div className="h-12 w-full bg-gray-800 rounded animate-pulse" />
            <div className="h-12 w-3/4 bg-gray-800 rounded animate-pulse" />
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
      listMetadata={listMetadata}
      taskMetadata={taskMetadata}
    />
  )
}
