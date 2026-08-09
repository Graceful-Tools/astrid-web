"use client"

export const dynamic = 'force-dynamic'

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { AuthenticatedApp } from "@/components/authenticated-app"
import { LoadingScreen } from "@/components/loading-screen"
import { createLogger } from '@/lib/logger'

const log = createLogger('[locale].lists.[listId].page.tsx')


export default function ListsPage() {
  const { data: session, status } = useSession()
  const params = useParams<{ listId?: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const listId = typeof params?.listId === "string" ? params.listId : ""
  const taskId = searchParams?.get('task') ?? null // Use query param for task: /lists/123?task=456

  const [listData, setListData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchList = async () => {
      if (!session?.user || !listId) return

      try {
        const response = await fetch(`/api/v1/lists/${listId}`)
        if (!response.ok) {
          if (response.status === 404) {
            // List not found - if we have a taskId, try to fall back to My Tasks view
            if (taskId) {
              log.info({ taskId }, 'List not found, falling back to My Tasks view with task:')
              router.replace(`/?task=${taskId}`)
              return
            }
            setError("List not found")
          } else if (response.status === 403) {
            // Access denied to list - if we have a taskId, try to fall back to My Tasks view
            // The task might still be accessible if it was shared directly or exists in other lists
            if (taskId) {
              log.info({ taskId }, 'Access denied to list, falling back to My Tasks view with task:')
              router.replace(`/?task=${taskId}`)
              return
            }
            setError("Access denied. You don't have permission to view this list.")
          } else {
            setError("Failed to load list")
          }
          return
        }

        const data = await response.json()
        setListData(data)
      } catch (err) {
        setError("Failed to load list")
        log.error({ err: err }, "Error fetching list:")
      } finally {
        setLoading(false)
      }
    }

    if (status === "authenticated") {
      fetchList()
    } else if (status === "unauthenticated") {
      // Store the intended destination and redirect to signin without callback
      sessionStorage.setItem('returnTo', window.location.href)
      router.replace('/auth/signin')
    }
  }, [session, listId, taskId, status, router])

  if (status === "loading" || loading) {
    return <LoadingScreen />
  }

  if (status === "unauthenticated") {
    return null // Will redirect
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl mb-4">📋</div>
          <h1 className="text-2xl font-bold text-white mb-2">List Not Available</h1>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  // Pass both listId and taskId to the main app
  return (
    <AuthenticatedApp
      initialSelectedListId={listId}
      initialSelectedTaskId={taskId || undefined}
      listMetadata={listData}
    />
  )
}
