"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RefreshCw } from "lucide-react"
import type { TaskList } from "@/types/task"

interface ExternalSyncSectionProps {
  list: TaskList
}

interface SyncLink {
  id: string
  astridListId: string
  remoteContainerId: string
  remoteContainerName?: string | null
}

interface ProviderState {
  connected: boolean
  link: SyncLink | null
  containers: Array<{ id: string; name: string }>
}

const EMPTY: ProviderState = { connected: false, link: null, containers: [] }

/**
 * External sync controls for a list's admin settings: link THIS list to a
 * GitHub repo (issues sync) or a Google Tasks list. Links are per-user —
 * each member mirrors to their own connected account. Uses the same
 * /api/v1/sync + /api/v1/integrations routes the iOS app calls (they accept
 * session cookies).
 */
export function ExternalSyncSection({ list }: ExternalSyncSectionProps) {
  const [github, setGithub] = useState<ProviderState>(EMPTY)
  const [google, setGoogle] = useState<ProviderState>(EMPTY)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const integrations = await fetch("/api/v1/integrations", { credentials: "include" })
        .then(r => (r.ok ? r.json() : { integrations: [] }))
        .then(d => d.integrations || [])

      const loadProvider = async (provider: string, base: string, containersKey: string): Promise<ProviderState> => {
        const connected = integrations.some((i: { provider: string; revokedAt?: string | null }) =>
          i.provider === provider && !i.revokedAt)
        if (!connected) return EMPTY
        const [links, containers] = await Promise.all([
          fetch(`/api/v1/sync/${base}/links?listId=${list.id}`, { credentials: "include" })
            .then(r => (r.ok ? r.json() : { links: [] }))
            .then(d => d.links || []),
          fetch(`/api/v1/sync/${base}/${containersKey}`, { credentials: "include" })
            .then(r => (r.ok ? r.json() : {}))
            .then((d: Record<string, Array<{ id: string; name: string }>>) => d[containersKey] || []),
        ])
        return { connected: true, link: links[0] || null, containers }
      }

      const [gh, g] = await Promise.all([
        loadProvider("GITHUB_ISSUES", "github", "repos"),
        loadProvider("GOOGLE_TASKS", "google", "tasklists"),
      ])
      setGithub(gh)
      setGoogle(g)
    } finally {
      setLoading(false)
    }
  }, [list.id])

  useEffect(() => { load() }, [load])

  const connect = async (base: string) => {
    const res = await fetch(`/api/v1/integrations/${base}/authorize`, { credentials: "include" })
    if (!res.ok) return
    const { url } = await res.json()
    if (url) window.open(url, "_blank", "noopener")
  }

  const link = async (base: string, containerId: string) => {
    await fetch(`/api/v1/sync/${base}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ astridListId: list.id, remoteContainerId: containerId }),
    })
    await load()
  }

  const unlink = async (base: string, linkId: string) => {
    await fetch(`/api/v1/sync/${base}/links?linkId=${linkId}`, {
      method: "DELETE",
      credentials: "include",
    })
    await load()
  }

  const renderProvider = (title: string, base: string, state: ProviderState) => (
    <div className="space-y-1.5">
      <Label className="text-sm theme-text-secondary">{title}</Label>
      {!state.connected ? (
        <div className="flex items-center gap-2">
          <p className="text-xs theme-text-muted flex-1">Not connected.</p>
          <Button variant="outline" size="sm" onClick={() => connect(base)}>
            Connect
          </Button>
        </div>
      ) : state.link ? (
        <div className="flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 theme-text-muted flex-shrink-0" />
          <span className="text-sm flex-1 truncate">
            {state.link.remoteContainerName || state.link.remoteContainerId}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-500 hover:text-red-400"
            onClick={() => unlink(base, state.link!.id)}
          >
            Unlink
          </Button>
        </div>
      ) : (
        <Select onValueChange={(value) => link(base, value)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose where to mirror this list" />
          </SelectTrigger>
          <SelectContent>
            {state.containers.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )

  if (loading) return null

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium theme-text-primary">External sync</h3>
        <p className="text-xs theme-text-muted">
          Mirror this list to another service and back, through your connected account.
        </p>
      </div>
      {renderProvider("GitHub Issues", "github", github)}
      {renderProvider("Google Tasks", "google", google)}
    </div>
  )
}
