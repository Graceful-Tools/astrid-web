"use client"

/**
 * Everything that can act as this account, with a way to stop each one.
 *
 * One list over five credential sources (GET /api/v1/users/me/connections):
 * OAuth apps the user made, apps approved on the consent page, Custom
 * Agents, user-level access tokens, and the webhook server. Each row says
 * which identity it authors as, because that is what an audit answers. Rows
 * the agents page owns say so and link there rather than pretending to
 * manage them here.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiDelete, apiGet } from '@/lib/api'
import { useTranslations } from '@/lib/i18n/client'
import type { V1Connection, V1ConnectionsResponse } from '@/lib/api-contracts/v1-ios-shapes'

const STATUS_TINT: Record<V1Connection['status'], string> = {
  active: 'bg-green-600 text-white',
  expired: 'text-yellow-600 dark:text-yellow-400',
  disabled: '',
}

function formatDate(value: string | null, never: string): string {
  return value ? new Date(value).toLocaleDateString() : never
}

export function ConnectionsList() {
  const { t } = useTranslations()
  const [connections, setConnections] = useState<V1Connection[] | null>(null)
  const [pending, setPending] = useState<V1Connection | null>(null)
  const [revoking, setRevoking] = useState(false)

  useEffect(() => {
    apiGet('/api/v1/users/me/connections')
      .then(res => res.json())
      .then((data: V1ConnectionsResponse) => setConnections(data.connections ?? []))
      .catch(() => {
        toast.error(t('settingsPages.connections.loadError'))
        setConnections([])
      })
    // Load once: `t` is not a stable identity across renders, and a fetch
    // keyed on it would reset the list after every revoke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const revoke = async () => {
    if (!pending) return
    const target = pending
    setRevoking(true)
    try {
      await apiDelete(`/api/v1/users/me/connections/${target.kind}/${target.id}`)
      setConnections(prev => (prev ?? []).filter(c => !(c.kind === target.kind && c.id === target.id)))
      toast.success(t('settingsPages.connections.revoked'))
      setPending(null)
    } catch {
      toast.error(t('settingsPages.connections.revokeError'))
    } finally {
      setRevoking(false)
    }
  }

  if (connections === null) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin theme-text-muted" />
      </div>
    )
  }

  if (connections.length === 0) {
    return (
      <p className="text-sm theme-text-muted text-center py-6">
        {t('settingsPages.connections.empty')}
      </p>
    )
  }

  const never = t('settingsPages.connections.columns.never')

  return (
    <div className="space-y-2">
      {connections.map(connection => (
        <div
          key={`${connection.kind}:${connection.id}`}
          data-connection-id={connection.id}
          data-connection-kind={connection.kind}
          className={`rounded-lg border theme-border p-3 space-y-2 ${
            connection.status === 'active' ? '' : 'opacity-70'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium theme-text-primary">{connection.name}</span>
                <Badge variant="outline" className="text-xs">
                  {t(`settingsPages.connections.kinds.${connection.kind}`)}
                </Badge>
                <Badge
                  variant={connection.status === 'active' ? 'default' : 'secondary'}
                  className={`text-xs ${STATUS_TINT[connection.status]}`}
                >
                  {t(`settingsPages.connections.status.${connection.status}`)}
                </Badge>
              </div>
              <div className="text-xs theme-text-muted">
                {t('settingsPages.connections.columns.actsAs')}:{' '}
                <span className="font-mono">
                  {connection.actsAs ?? t('settingsPages.connections.actsAsYou')}
                </span>
              </div>
              {connection.scopes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {connection.scopes.map(scope => (
                    <Badge key={scope} variant="secondary" className="text-[10px] font-mono">
                      {scope}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="text-xs theme-text-muted">
                {t('settingsPages.connections.columns.created')} {formatDate(connection.createdAt, never)}
                {' · '}
                {t('settingsPages.connections.columns.lastUsed')} {formatDate(connection.lastUsedAt, never)}
                {connection.expiresAt && (
                  <>
                    {' · '}
                    {t('settingsPages.connections.columns.expires')} {formatDate(connection.expiresAt, never)}
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {connection.revocable && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  onClick={() => setPending(connection)}
                >
                  <ShieldOff className="w-4 h-4 mr-1" />
                  {t('settingsPages.connections.revoke')}
                </Button>
              )}
              {connection.manageIn === 'agents' && (
                <Link href="/settings/agents" className="text-xs text-blue-500 hover:underline">
                  {t('settingsPages.connections.manageInAgents')}
                </Link>
              )}
            </div>
          </div>
        </div>
      ))}

      <Dialog open={!!pending} onOpenChange={open => !open && !revoking && setPending(null)}>
        <DialogContent className="theme-bg-secondary theme-border">
          <DialogHeader>
            <DialogTitle className="text-red-400">
              {t('settingsPages.connections.revoke')}
            </DialogTitle>
            <DialogDescription className="theme-text-muted">
              {pending &&
                t(
                  pending.kind === 'customAgent'
                    ? 'settingsPages.connections.removeAgentConfirm'
                    : 'settingsPages.connections.revokeConfirm',
                  { name: pending.name }
                )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={revoking}>
              {t('settingsPages.connections.cancel')}
            </Button>
            <Button variant="destructive" onClick={revoke} disabled={revoking}>
              {revoking ? <Loader2 className="w-4 h-4 animate-spin" /> : t('settingsPages.connections.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
