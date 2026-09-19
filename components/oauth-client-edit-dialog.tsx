"use client"

/**
 * Edit the metadata an integration needs on an existing OAuth connection —
 * today, its redirect URIs.
 *
 * Extracted from `oauth-app-manager.tsx`, which sits on the oversized-files
 * ratchet (task 9377bc2c): that ratchet asks for a piece to come out rather
 * than for the budget to go up, and this dialog and its state were the most
 * self-contained piece left.
 *
 * One thing did change on the way over. It called the v1 endpoint through a
 * bare window fetch, which the API boundary guard only sees on lines a diff
 * adds — so moving the file is what surfaced it. It now goes through
 * `lib/api.ts` like the rest. (Spelling the old call out literally here would
 * trip that same guard on this comment, which is why it is described.)
 */

import { useEffect, useState } from 'react'
import { BRAND } from '@/lib/brand/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiCall, refusalReason } from '@/lib/api'
import { toast } from 'sonner'

interface EditableClient {
  clientId: string
  name: string
  description: string | null
  redirectUris: string[]
}

interface OAuthClientEditDialogProps {
  client: EditableClient | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful save so the caller can refresh its list. */
  onUpdated: () => void | Promise<void>
}

export function OAuthClientEditDialog({
  client,
  open,
  onOpenChange,
  onUpdated,
}: OAuthClientEditDialogProps) {
  const [redirectUrisInput, setRedirectUrisInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRedirectUrisInput((client?.redirectUris ?? []).join('\n'))
  }, [client])

  const close = () => onOpenChange(false)

  const save = async () => {
    if (!client) return
    const redirectUris = redirectUrisInput
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)

    try {
      setSaving(true)
      // apiCall rather than the raw fetch this arrived with: it is the
      // canonical client, and apiPut would route a settings write through the
      // offline mutation queue, which is for tasks and lists. It throws
      // ApiError on a 4xx instead of returning a non-ok response.
      await apiCall(`/api/v1/oauth/clients/${client.clientId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: client.name,
          description: client.description,
          redirectUris,
        }),
      })

      toast.success('OAuth client updated')
      close()
      await onUpdated()
    } catch (err) {
      console.error('Failed to update OAuth client:', err)
      // The server's own 4xx sentence (an invalid redirect URI, a client the
      // caller does not own); nothing from a 5xx.
      toast.error(refusalReason(err) ?? 'Failed to update OAuth client')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Same column-with-one-scroller shape as the scope dialog, and for the
          same reason: DialogContent caps no height, so on a phone a tall body
          pushes the actions off the bottom of the screen. */}
      <DialogContent className="max-w-xl flex flex-col max-h-[85vh] supports-[height:100dvh]:max-h-[85dvh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit OAuth Application</DialogTitle>
          <DialogDescription>
            Update redirect URLs or other metadata required by your integrations.
          </DialogDescription>
        </DialogHeader>

        {client ? (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
            <div>
              <Label>Application</Label>
              <Input value={client.name} readOnly className="bg-gray-50" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={client.description || ''} readOnly className="bg-gray-50" />
            </div>
            <div>
              <Label htmlFor="redirect-uris-edit">Redirect URIs</Label>
              <Textarea
                id="redirect-uris-edit"
                value={redirectUrisInput}
                onChange={(e) => setRedirectUrisInput(e.target.value)}
                className="font-mono text-sm mt-1"
                rows={5}
                placeholder="https://chat.openai.com/aip/.../oauth/callback"
              />
              <p className="text-xs theme-text-muted mt-2">
                One URL per line. {BRAND.appName} will only redirect users to the exact URLs listed here. Add ChatGPT&apos;s action callback URL (from GPT Builder) to fix <code>invalid_redirect_uri</code> errors.
              </p>
            </div>
            </div>

            <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button onClick={save} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm theme-text-muted">Select an OAuth app to edit.</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
