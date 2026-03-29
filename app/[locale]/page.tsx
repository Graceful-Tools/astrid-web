"use client"

import { useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AuthenticatedApp } from "@/components/authenticated-app"

// App shell skeleton — large enough to be the LCP element instead of small text
function AppSkeleton() {
  return (
    <div className="min-h-screen theme-bg-primary flex">
      {/* Sidebar skeleton */}
      <div className="w-64 border-r theme-border hidden md:block p-4">
        <div className="h-8 w-32 bg-gray-800 rounded animate-pulse mb-6" />
        <div className="space-y-3">
          <div className="h-6 w-full bg-gray-800 rounded animate-pulse" />
          <div className="h-6 w-3/4 bg-gray-800 rounded animate-pulse" />
          <div className="h-6 w-5/6 bg-gray-800 rounded animate-pulse" />
        </div>
      </div>
      {/* Main content skeleton */}
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

function PageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    // Check for return URL after authentication
    const checkReturnTo = searchParams?.get('checkReturnTo')
    if (checkReturnTo) {
      const returnTo = sessionStorage.getItem('returnTo')
      if (returnTo) {
        sessionStorage.removeItem('returnTo')
        router.replace(returnTo)
      } else {
        router.replace('/')
      }
    }
  }, [searchParams, router])

  // Extract task ID from search params for My Tasks view
  const taskId = searchParams?.get('task')

  return <AuthenticatedApp initialSelectedTaskId={taskId || undefined} />
}

export default function Page() {
  return (
    <Suspense fallback={<AppSkeleton />}>
      <PageContent />
    </Suspense>
  )
}
