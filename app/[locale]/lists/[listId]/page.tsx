"use client"

export const dynamic = 'force-dynamic'

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { unwrapList } from "@/lib/v1-response"
import { useSession } from "next-auth/react"
import { AuthenticatedApp } from "@/components/authenticated-app"
import { LoadingScreen } from "@/components/loading-screen"
import { createLogger } from '@/lib/logger'
import { useTranslations } from '@/lib/i18n/client'

const log = createLogger('[locale].lists.[listId].page.tsx')


export default function ListsPage() {
  const { t } = useTranslations()
  const { data: session, status } = useSession()
  const params = useParams<{ listId?: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const listId = typeof params?.listId === "string" ? params.listId : ""
  const taskId = searchParams?.get('task') ?? null // Use query param for task: /lists/123?task=456

  const [listData, setListData] = useState(null)
  const [loading, setLoading] = useState(true)
  // An i18n key, translated when shown: the effect below does not depend on the language.
  const [error, setError] = useState<string | null>(null)
  // Read by the 404/403 fallback, not a dependency: opening a task must not
  // fetch the list again. Offline, that refetch failed and replaced the whole
  // app with the error screen (AWTD-1417).
  const taskIdRef = useRef(taskId)
  taskIdRef.current = taskId

  const userId = session?.user?.id

  useEffect(() => {
    const fetchList = async () => {
      if (!userId || !listId) return
      const taskId = taskIdRef.current

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
            setError("errorPages.listNotFound")
          } else if (response.status === 403) {
            // Access denied to list - if we have a taskId, try to fall back to My Tasks view
            // The task might still be accessible if it was shared directly or exists in other lists
            if (taskId) {
              log.info({ taskId }, 'Access denied to list, falling back to My Tasks view with task:')
              router.replace(`/?task=${taskId}`)
              return
            }
            setError("errorPages.listAccessDenied")
          } else if (!navigator.onLine) {
            // The service worker's offline answer. The app runs from its
            // cache, so keep it rather than the error screen (AWTD-1417).
            log.info({ status: response.status }, 'Offline: list not refreshed, using cached data')
          } else {
            setError("errorPages.listLoadFailed")
          }
          return
        }

        // GET /api/v1/lists/:id returns { list, meta }. TaskManager compares
        // listMetadata.id, so the envelope matched nothing (AWTD-1426).
        setListData(unwrapList(await response.json()))
      } catch (err) {
        if (!navigator.onLine) {
          log.info('Offline: list not refreshed, using cached data')
          return
        }
        setError("errorPages.listLoadFailed")
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
  }, [userId, listId, status, router])

  if (status === "loading" || loading) {
    return <LoadingScreen />
  }

  if (status === "unauthenticated") {
    return null // Will redirect
  }

  if (error) {
    return (
      <div className="min-h-screen bg-theme-primary flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl mb-4">📋</div>
          <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('errorPages.listUnavailableTitle')}</h1>
          <p className="text-theme-muted mb-6">{t(error)}</p>
          <button
            onClick={() => router.push('/')}
            className="bg-brand hover:bg-brand-hover text-brand-foreground px-6 py-2 rounded-lg"
          >
            {t('errorPages.goToDashboard')}
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
