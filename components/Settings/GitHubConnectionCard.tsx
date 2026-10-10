"use client"

/**
 * Settings → Connections → GitHub: the one place for the GitHub App
 * connection (AWTD-1114, spec §7.4).
 *
 * It used to be split across a collapsed card on the Agents page made of two
 * components — one listing the first linked installation's repos, one probing
 * for installations — neither of which knew about a second org. This lists
 * every installation the user can act on (GET /api/v1/github/installations,
 * from the installation model) with its repo count, and is where you add an
 * org, refresh repos, or disconnect one.
 *
 * The setup route lands here with `?github=<outcome>`; that outcome used to be
 * dropped on the floor, so a refused link looked exactly like a slow one.
 */

import { useCallback, useEffect, useState } from 'react'
import { Building2, Github, Loader2, Plus, RefreshCw, User } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiGet, apiPost } from '@/lib/api'
import { BRAND } from '@/lib/brand/config'
import { useTranslations } from '@/lib/i18n/client'
import type { InstallationSummary } from '@/lib/github/installations'

/** The outcomes app/api/github/setup/route.ts redirects with. */
const SETUP_OUTCOMES = {
  connected: 'success',
  updated: 'success',
  not_authorized: 'error',
  already_connected: 'error',
  verification_unavailable: 'error',
  error: 'error',
} as const

type SetupOutcome = keyof typeof SETUP_OUTCOMES

function isSetupOutcome(value: string | null): value is SetupOutcome {
  return value !== null && value in SETUP_OUTCOMES
}

interface GitHubConnectionCardViewProps {
  installations: InstallationSummary[] | null
  busy: 'install' | 'refresh' | null
  onInstall: () => void
  onRefresh: () => void
  onDisconnect: (installation: InstallationSummary) => void
}

/** Presentation only, so it can be rendered and measured without the API. */
export function GitHubConnectionCardView({
  installations,
  busy,
  onInstall,
  onRefresh,
  onDisconnect,
}: GitHubConnectionCardViewProps) {
  const { t } = useTranslations()
  const connected = (installations?.length ?? 0) > 0

  return (
    <Card className="theme-bg-secondary theme-border" data-testid="github-connection-card">
      <CardHeader>
        <CardTitle className="theme-text-primary flex items-center gap-2">
          <Github className="w-5 h-5" />
          {t('settingsPages.connections.github.title')}
        </CardTitle>
        <CardDescription className="theme-text-muted">
          {t('settingsPages.connections.github.description', { appName: BRAND.appName })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {installations === null ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin theme-text-muted" />
          </div>
        ) : !connected ? (
          <p className="text-sm theme-text-muted">{t('settingsPages.connections.github.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {installations.map(installation => (
              <li
                key={installation.id}
                data-installation-id={installation.id}
                className={`rounded-lg border theme-border p-3 flex flex-wrap items-center justify-between gap-2 ${
                  installation.suspended ? 'opacity-70' : ''
                }`}
              >
                <div className="min-w-0 flex items-center gap-2">
                  {installation.accountType === 'User' ? (
                    <User className="w-4 h-4 theme-text-muted shrink-0" />
                  ) : (
                    <Building2 className="w-4 h-4 theme-text-muted shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium theme-text-primary break-all">
                        {installation.accountLogin}
                      </span>
                      {installation.suspended && (
                        <Badge variant="secondary" className="text-xs">
                          {t('settingsPages.connections.github.suspended')}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs theme-text-muted">
                      {installation.accountType === 'User'
                        ? t('settingsPages.connections.github.personal')
                        : t('settingsPages.connections.github.organization')}
                      {' · '}
                      {installation.repoCount === 1
                        ? t('settingsPages.connections.github.repoCountOne')
                        : t('settingsPages.connections.github.repoCountMany', {
                            count: String(installation.repoCount),
                          })}
                      {installation.repositorySelection === 'all' &&
                        ` (${t('settingsPages.connections.github.allRepos')})`}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-600 hover:bg-red-500/10 shrink-0"
                  onClick={() => onDisconnect(installation)}
                >
                  {t('settingsPages.connections.github.disconnect')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {/* Not until the list is in: "Connect" on an account that is already
            connected would start a second install for nothing. */}
        {installations !== null && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={connected ? 'outline' : 'default'}
              size="sm"
              onClick={onInstall}
              disabled={busy !== null}
            >
              {busy === 'install' ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : connected ? (
                <Plus className="w-4 h-4 mr-2" />
              ) : (
                <Github className="w-4 h-4 mr-2" />
              )}
              {connected
                ? t('settingsPages.connections.github.installAnother')
                : t('settingsPages.connections.github.connect')}
            </Button>
            {connected && (
              <Button variant="outline" size="sm" onClick={onRefresh} disabled={busy !== null}>
                <RefreshCw className={`w-4 h-4 mr-2 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
                {t('settingsPages.connections.github.refresh')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function GitHubConnectionCard() {
  const { t } = useTranslations()
  const [installations, setInstallations] = useState<InstallationSummary[] | null>(null)
  const [busy, setBusy] = useState<'install' | 'refresh' | null>(null)
  const [pending, setPending] = useState<InstallationSummary | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  // Resolves to the list, or to [] after saying it could not be loaded.
  const fetchInstallations = useCallback(
    (): Promise<InstallationSummary[]> =>
      apiGet('/api/v1/github/installations')
        .then(res => res.json())
        .then((data: { installations?: InstallationSummary[] }) => data.installations ?? [])
        .catch(() => {
          toast.error(t('settingsPages.connections.github.loadError'))
          return []
        }),
    // `t` is not a stable identity across renders; keying on it would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    fetchInstallations().then(setInstallations)

    // Say what the setup round trip decided, once, then drop the parameter so
    // a reload does not repeat it.
    const params = new URLSearchParams(window.location.search)
    const outcome = params.get('github')
    if (isSetupOutcome(outcome)) {
      const message = t(`settingsPages.connections.github.outcomes.${outcome}`)
      if (SETUP_OUTCOMES[outcome] === 'success') toast.success(message)
      else toast.error(message)
      params.delete('github')
      const query = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchInstallations])

  const install = async () => {
    setBusy('install')
    try {
      const res = await apiGet('/api/github/install-url')
      const { installUrl } = (await res.json()) as { installUrl?: string }
      if (!installUrl) throw new Error('no installUrl')
      window.location.href = installUrl
    } catch {
      toast.error(t('settingsPages.connections.github.installError'))
      setBusy(null)
    }
  }

  const refresh = async () => {
    setBusy('refresh')
    try {
      await apiPost('/api/github/repositories/refresh', {})
      setInstallations(await fetchInstallations())
      toast.success(t('settingsPages.connections.github.refreshed'))
    } catch {
      toast.error(t('settingsPages.connections.github.refreshError'))
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async () => {
    if (!pending) return
    const target = pending
    setDisconnecting(true)
    try {
      await apiPost('/api/github/disconnect', { installationId: target.id })
      setInstallations(prev => (prev ?? []).filter(i => i.id !== target.id))
      toast.success(t('settingsPages.connections.github.disconnected', { account: target.accountLogin }))
      setPending(null)
    } catch {
      toast.error(t('settingsPages.connections.github.disconnectError'))
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <>
      <GitHubConnectionCardView
        installations={installations}
        busy={busy}
        onInstall={install}
        onRefresh={refresh}
        onDisconnect={setPending}
      />
      <Dialog open={pending !== null} onOpenChange={open => !open && !disconnecting && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('settingsPages.connections.github.disconnectTitle', { account: pending?.accountLogin ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t('settingsPages.connections.github.disconnectDescription', {
                account: pending?.accountLogin ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={disconnecting}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={disconnect} disabled={disconnecting}>
              {disconnecting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('settingsPages.connections.github.disconnect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
