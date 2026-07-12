'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Admin route failed', error)
  }, [error])

  return <main className="container mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-12">
    <div className="w-full rounded-xl border bg-background p-6 shadow-sm">
      <AlertTriangle className="mb-4 h-8 w-8 text-amber-600" />
      <h1 className="text-xl font-semibold">Admin page couldn’t load</h1>
      <p className="mt-2 text-sm text-muted-foreground">A client update or temporary connection problem may have interrupted this page. Retry with the current version.</p>
      <div className="mt-6 flex gap-3">
        <Button onClick={reset}>Retry</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>Reload page</Button>
      </div>
    </div>
  </main>
}
