"use client"

/**
 * Put an existing OAuth connection on a scope group, and take whatever that
 * group grants that it lacks (AWTD-962).
 *
 * WHY THIS EXISTS. `reconcileClientScopes` tops a client up to its group on
 * every token request, but its first bound is "no group, no change" — so it
 * does nothing until something records the group, and on 2026-09-19 every one
 * of the 23 `OAuthClient` rows in production carried `scopeGroup: null`. The
 * three code paths that stamp a group each own one known client; a connection
 * created here in Settings is reachable from none of them. Without this
 * dialog, the only way such a connection gains `chat:read`/`chat:write` is a
 * hand-written UPDATE against the production row — the manual grant Jon
 * rejected on 2026-09-16 as "a favour, not a standard".
 *
 * The server does all the widening. This names a group and reports what came
 * back; the union / never-the-wildcard / named-group bounds stay in
 * `lib/oauth/scope-reconcile.ts` so there is one copy of them.
 *
 * It lives in its own file because `oauth-app-manager.tsx` is on the
 * oversized-files ratchet (task 9377bc2c) at 901 lines.
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SCOPE_GROUPS } from '@/lib/oauth/oauth-scopes'
import { apiCall, refusalReason } from '@/lib/api'
import { toast } from 'sonner'

type ScopeGroupName = keyof typeof SCOPE_GROUPS

interface ScopeGroupClient {
  clientId: string
  name: string
  scopes: string[]
  scopeGroup: string | null
}

interface OAuthScopeGroupDialogProps {
  client: ScopeGroupClient | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful update so the caller can refresh its list. */
  onUpdated: () => void | Promise<void>
}

export function OAuthScopeGroupDialog({
  client,
  open,
  onOpenChange,
  onUpdated,
}: OAuthScopeGroupDialogProps) {
  const [chosen, setChosen] = useState<ScopeGroupName>('ai_agent')
  const [saving, setSaving] = useState(false)

  // Start on the group the connection already follows, so re-opening the
  // dialog on an adopted client does not silently propose a different one.
  useEffect(() => {
    if (!client) return
    setChosen(
      client.scopeGroup && client.scopeGroup in SCOPE_GROUPS
        ? (client.scopeGroup as ScopeGroupName)
        : 'ai_agent',
    )
  }, [client])

  const close = () => onOpenChange(false)

  const apply = async () => {
    if (!client) return

    try {
      setSaving(true)
      // apiCall, not apiPut: apiPut routes through the offline-aware queue, and
      // a privilege change that replays later out of a queue is not what
      // anyone pressing this button is asking for. Throws ApiError on a 4xx.
      const response = await apiCall(`/api/v1/oauth/clients/${client.clientId}`, {
        method: 'PUT',
        body: JSON.stringify({ scopeGroup: chosen }),
      })
      const data = await response.json()
      const added: string[] = data.added ?? []

      // Say what actually changed. "Saved" on a no-op reads as a grant that did
      // not happen, which is how this entire class of bug went unnoticed.
      toast.success(
        added.length
          ? `Added ${added.join(', ')}. Tokens already issued keep their old scopes.`
          : `Following ${chosen}. Nothing to add — this connection is already current.`,
      )

      close()
      await onUpdated()
    } catch (err) {
      console.error('Failed to update scope group:', err)
      // refusalReason surfaces the server's own 4xx sentence — an unknown
      // group, a client the caller does not own — and nothing from a 5xx.
      toast.error(refusalReason(err) ?? 'Failed to update scope group')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Scope Group</DialogTitle>
          <DialogDescription>
            A connection that follows a scope group is topped up to that group whenever it
            requests a token, so a scope added later reaches it without anyone editing the
            database. Scopes are only ever added — nothing this connection already holds is
            removed.
          </DialogDescription>
        </DialogHeader>

        {client ? (
          <div className="space-y-4">
            <div>
              <Label>Application</Label>
              <Input value={client.name} readOnly className="bg-gray-50" />
            </div>

            <div className="space-y-2">
              <Label>Follow</Label>
              {(Object.keys(SCOPE_GROUPS) as ScopeGroupName[]).map(group => {
                const held = new Set<string>(client.scopes)
                const wouldAdd = SCOPE_GROUPS[group].filter(scope => !held.has(scope))
                return (
                  <label
                    key={group}
                    className="flex items-start gap-3 rounded border p-3 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="scope-group"
                      className="mt-1"
                      checked={chosen === group}
                      onChange={() => setChosen(group)}
                    />
                    <span className="flex-1">
                      <span className="font-mono text-sm">{group}</span>
                      {client.scopeGroup === group && (
                        <Badge variant="outline" className="ml-2 text-xs">current</Badge>
                      )}
                      <span className="block text-xs theme-text-muted mt-1">
                        {wouldAdd.length
                          ? `Adds ${wouldAdd.join(', ')}`
                          : 'Adds nothing — this connection already holds every scope in this group'}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>

            <p className="text-xs theme-text-muted">
              Tokens already issued keep the scopes they were minted with. Request a new one to
              pick up the change.
            </p>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button onClick={apply} disabled={saving}>
                {saving ? 'Updating...' : 'Update Scopes'}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm theme-text-muted">Select an OAuth app.</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
