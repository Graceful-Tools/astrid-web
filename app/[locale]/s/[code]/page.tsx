"use client"

export const dynamic = 'force-dynamic'

import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { LoadingScreen } from "@/components/loading-screen"
import { createLogger } from '@/lib/logger'

const log = createLogger('[locale].s.[code].page.tsx')


export default function ShortcodePage() {
  const params = useParams<{ code?: string }>()
  const router = useRouter()
  const { data: session, status } = useSession()
  const code = typeof params?.code === "string" ? params.code : ""
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const resolveShortcode = async () => {
      if (!code) return

      // Wait for auth to load
      if (status === "loading") return

      // If not authenticated, redirect to sign in with return URL
      if (status === "unauthenticated") {
        const returnUrl = encodeURIComponent(`/s/${code}`)
        router.push(`/auth/signin?callbackUrl=${returnUrl}`)
        return
      }

      try {
        const response = await fetch(`/api/shortcodes/${code}`)

        if (!response.ok) {
          if (response.status === 404) {
            setError("Link not found or expired")
          } else {
            setError("Failed to resolve link")
          }
          return
        }

        const data = await response.json()
        const { targetType, targetId } = data

        // Redirect to appropriate page
        if (targetType === "task") {
          // Fetch the task to determine which list to use for navigation
          try {
            const taskResponse = await fetch(`/api/tasks/${targetId}`, {
              credentials: 'include', // Include session cookie
              headers: {
                'Content-Type': 'application/json',
              },
            })

            if (taskResponse.ok) {
              const task = await taskResponse.json()

              // Get the task's lists (ordered by priority)
              if (task.lists && task.lists.length > 0) {
                // Check if user has access to any of the task's lists
                // The API will filter task.lists to only include lists user has access to
                const primaryList = task.lists[0]

                // Try to redirect to list context first
                // The list page will handle the case where user no longer has access
                // and redirect to My Tasks view if needed
                router.replace(`/lists/${primaryList.id}?task=${targetId}`)
              } else {
                // Task has no lists, fall back to My Tasks view
                // This handles: orphaned tasks, tasks user created without lists, etc.
                router.replace(`/?task=${targetId}`)
              }
            } else if (taskResponse.status === 404) {
              setError("Task not found or no longer accessible")
            } else if (taskResponse.status === 403) {
              setError("You don't have permission to view this task")
            } else {
              // Other errors - fall back to My Tasks (might still work if task is in accessible lists)
              router.replace(`/?task=${targetId}`)
            }
          } catch (taskErr) {
            log.error({ err: taskErr }, "Error fetching task details:")
            // Network error or other issue - try falling back to My Tasks
            router.replace(`/?task=${targetId}`)
          }
        } else if (targetType === "list") {
          router.replace(`/lists/${targetId}`)
        } else {
          setError("Invalid link type")
        }
      } catch (err) {
        log.error({ err: err }, "Error resolving shortcode:")
        setError("Failed to resolve link")
      }
    }

    resolveShortcode()
  }, [code, router, status])

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl mb-4">🔗</div>
          <h1 className="text-2xl font-bold text-white mb-2">Link Error</h1>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return <LoadingScreen />
}
