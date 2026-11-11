"use client"

export const dynamic = 'force-dynamic'

import { useParams, useRouter } from "next/navigation"
import { unwrapList } from '@/lib/v1-response'
import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { AuthenticatedApp } from "@/components/authenticated-app"
import { LoadingScreen } from "@/components/loading-screen"
import { createLogger } from '@/lib/logger'
import { useTranslations } from '@/lib/i18n/client'

const log = createLogger('[locale].list.[id].page.tsx')


export default function ListPage() {
  const { t } = useTranslations()
  const { data: session, status } = useSession()
  const params = useParams<{ id?: string }>()
  const router = useRouter()
  const listId = typeof params?.id === "string" ? params.id : ""

  const [listData, setListData] = useState(null)
  const [loading, setLoading] = useState(true)
  // An i18n key, translated when shown: the effect below does not depend on the language.
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchList = async () => {
      if (!session?.user || !listId) return

      try {
        const response = await fetch(`/api/v1/lists/${listId}`)
        if (!response.ok) {
          if (response.status === 404) {
            setError("errorPages.listNotFound")
          } else if (response.status === 403) {
            setError("errorPages.listAccessDenied")
          } else if (!navigator.onLine) {
            // The service worker's offline answer: keep the app on its cached
            // data rather than the error screen (AWTD-1417).
            log.info({ status: response.status }, 'Offline: list not refreshed, using cached data')
          } else {
            setError("errorPages.listLoadFailed")
          }
          return
        }

        // v1 wraps the list: { list, meta }. Storing the envelope handed
        // TaskManager an object with no `id`, so its chat-eligibility fallback
        // never matched — and that fallback fails OPEN
        // (userCanRequestListChatChannel returns true for a null list), so the
        // rules were skipped rather than applied for any list reached by direct
        // link and not already loaded. (Task 72717eff.)
        const data = await response.json()
        setListData(unwrapList(data))
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
  }, [session, listId, status, router])

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

  // Pass the selectedListId to the main app so it shows the specific list
  return (
    <AuthenticatedApp 
      initialSelectedListId={listId}
      listMetadata={listData}
    />
  )
}
