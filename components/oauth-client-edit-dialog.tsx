"use client"

/**
 * Edit the metadata an integration needs on an existing OAuth connection —
 * today, its redirect URIs — and point at where its scopes are edited.
 *
 * Jon, AWTD-1513: "the connection edit cards didn't show how to edit scope".
 * Scopes are not edited here (a privilege change gets its own dialog and its
 * own save), but this is where people look, so it shows what the connection
 * holds and hands off to the permissions dialog.
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
import { Badge } from '@/components/ui/badge'
import { ShieldPlus } from 'lucide-react'
import { apiCall, refusalReason } from '@/lib/api'
import { useTranslations } from '@/lib/i18n/client'
import { RichMessage } from '@/components/shared/RichMessage'
import { toast } from 'sonner'

interface EditableClient {
  clientId: string
  name: string
  description: string | null
  redirectUris: string[]
  scopes?: string[]
}

interface OAuthClientEditDialogProps {
  client: EditableClient | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful save so the caller can refresh its list. */
  onUpdated: () => void | Promise<void>
  /** Opens the permissions dialog for this client (AWTD-1513). */
  onEditScopes?: () => void
}

export function OAuthClientEditDialog({
  client,
  open,
  onOpenChange,
  onUpdated,
  onEditScopes,
}: OAuthClientEditDialogProps) {
  const { t } = useTranslations()
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

      toast.success(t('settingsPages.apiAccess.apps.updated'))
      close()
      await onUpdated()
    } catch (err) {
      console.error('Failed to update OAuth client:', err)
      // The server's own 4xx sentence (an invalid redirect URI, a client the
      // caller does not own); nothing from a 5xx.
      toast.error(refusalReason(err) ?? t('settingsPages.apiAccess.apps.errors.updateFailed'))
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
          <DialogTitle>{t('settingsPages.apiAccess.apps.editTitle')}</DialogTitle>
          <DialogDescription>
            {t('settingsPages.apiAccess.apps.editDescription')}
          </DialogDescription>
        </DialogHeader>

        {client ? (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
            <div>
              <Label>{t('settingsPages.connections.permissions.application')}</Label>
              <Input value={client.name} readOnly className="bg-theme-secondary" />
            </div>
            <div>
              <Label>{t('settingsPages.apiAccess.apps.descriptionLabel')}</Label>
              <Input value={client.description || ''} readOnly className="bg-theme-secondary" />
            </div>
            <div>
              <Label>{t('settingsPages.connections.columns.scopes')}</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {(client.scopes ?? []).map(scope => (
                  <Badge key={scope} variant="secondary" className="text-xs">{scope}</Badge>
                ))}
              </div>
              {onEditScopes && (
                <Button variant="outline" size="sm" className="mt-2" onClick={onEditScopes}>
                  <ShieldPlus className="w-4 h-4 mr-2" />
                  {t('settingsPages.connections.permissions.edit')}
                </Button>
              )}
            </div>
            <div>
              <Label htmlFor="redirect-uris-edit">{t('settingsPages.apiAccess.apps.redirectUris')}</Label>
              <Textarea
                id="redirect-uris-edit"
                value={redirectUrisInput}
                onChange={(e) => setRedirectUrisInput(e.target.value)}
                className="font-mono text-sm mt-1"
                rows={5}
                placeholder="https://chat.openai.com/aip/.../oauth/callback"
              />
              <p className="text-xs theme-text-muted mt-2">
                <RichMessage message={t('settingsPages.apiAccess.apps.editRedirectHelp')} values={{ appName: BRAND.appName, code: <code>invalid_redirect_uri</code> }} />
              </p>
            </div>
            </div>

            <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={close}>{t('common.cancel')}</Button>
              <Button onClick={save} disabled={saving}>
                {saving ? t('settingsPages.connections.permissions.saving') : t('settingsPages.profileInfo.saveChanges')}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm theme-text-muted">{t('settingsPages.apiAccess.apps.selectToEdit')}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
