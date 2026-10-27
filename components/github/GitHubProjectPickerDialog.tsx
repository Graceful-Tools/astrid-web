"use client"

/**
 * "Connect a GitHub project" (AWTD-1302): pick an organization project and
 * turn it into a board.
 *
 * Lists every org installation the user can act on and, in each, the projects
 * the user can see (GET /api/v1/github/projects). Binding one
 * (POST …/{nodeId}/bind) creates the board and starts its import in the
 * background, so the user lands on the board straight away and watches it
 * fill. A project that is already a board opens it instead.
 *
 * When the server has no GitHub token for the user (auth_required), or no
 * organization is connected yet, it offers the way forward instead of an empty
 * list: authorize the App (the setup route's sync leg, which comes back here)
 * or install it on an organization.
 */

import { useCallback, useEffect, useState } from 'react'
import { Building2, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Github } from "@/components/ui/brand-icons"
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiGet, apiPost } from '@/lib/api'
import { BRAND } from '@/lib/brand/config'
import { GITHUB_WEB_URL } from '@/lib/github/host'
import { useTranslations } from '@/lib/i18n/client'
import { CONNECT_GITHUB_PROJECT_PARAM } from '@/lib/github/project-picker-param'

interface PickerProject {
  nodeId: string
  number: number
  title: string
  url: string
  closed: boolean
  itemCount: number
  boundProjectId: string | null
  boundListId?: string | null
}

interface PickerInstallation {
  installationId: number
  accountLogin: string
  projects: PickerProject[]
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; installations: PickerInstallation[] }
  | { kind: 'authRequired' }
  | { kind: 'error' }

/** The App's install page, where GitHub lets the user pick an organization. */
export function githubAppInstallUrl(): string {
  return `${GITHUB_WEB_URL}/apps/${BRAND.githubAppSlug}/installations/new`
}

/** Authorize the App and come back with the picker open (setup route, sync leg). */
export function githubAccessSyncUrl(returnTo?: string): string {
  const base = '/api/github/setup?sync=1'
  return returnTo ? `${base}&return=${encodeURIComponent(returnTo)}` : base
}

function errorStatus(err: unknown): { status?: number; code?: string } {
  const e = err as { status?: number; detail?: { error?: string } } | null
  return { status: e?.status, code: e?.detail?.error }
}

/**
 * Back from authorizing the App, the picker reopens on Settings → Connections
 * (the GitHub card consumes the parameter), wherever it was opened from.
 */
const RETURN_TO_PICKER = `/settings/connections?${CONNECT_GITHUB_PROJECT_PARAM}=1`

interface GitHubProjectPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where to go once a board exists. Defaults to a full navigation, so the new list loads. */
  navigate?: (path: string) => void
}

export function GitHubProjectPickerDialog({ open, onOpenChange, navigate }: GitHubProjectPickerDialogProps) {
  const { t } = useTranslations()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [binding, setBinding] = useState<string | null>(null)

  const go = useCallback(
    (path: string) => (navigate ? navigate(path) : window.location.assign(path)),
    [navigate],
  )

  // No synchronous "loading" here: the state starts there, and a reload sets it itself.
  const load = useCallback(async () => {
    try {
      const res = await apiGet('/api/v1/github/projects')
      const body = (await res.json()) as { installations?: PickerInstallation[] }
      setState({ kind: 'ready', installations: body.installations ?? [] })
    } catch (err) {
      const { code } = errorStatus(err)
      setState(code === 'auth_required' ? { kind: 'authRequired' } : { kind: 'error' })
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const reload = () => {
    setState({ kind: 'loading' })
    void load()
  }

  const choose = async (installation: PickerInstallation, project: PickerProject) => {
    if (project.boundListId) {
      go(`/lists/${project.boundListId}`)
      return
    }
    setBinding(project.nodeId)
    try {
      const res = await apiPost(`/api/v1/github/projects/${encodeURIComponent(project.nodeId)}/bind`, {
        installationId: installation.installationId,
      })
      const body = (await res.json()) as { listId?: string }
      if (!body.listId) throw new Error('no listId')
      toast.success(t('githubProjectPicker.bound', { title: project.title }))
      go(`/lists/${body.listId}`)
    } catch (err) {
      const { status, code } = errorStatus(err)
      if (code === 'auth_required') setState({ kind: 'authRequired' })
      else if (status === 409) {
        toast.error(t('githubProjectPicker.alreadyBound'))
        reload()
      } else toast.error(t('githubProjectPicker.bindError'))
      setBinding(null)
    }
  }

  const installUrl = githubAppInstallUrl()
  const syncUrl = githubAccessSyncUrl(RETURN_TO_PICKER)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl flex flex-col max-h-[85vh] supports-[height:100dvh]:max-h-[85dvh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="w-5 h-5" />
            {t('githubProjectPicker.title')}
          </DialogTitle>
          <DialogDescription>{t('githubProjectPicker.description', { appName: BRAND.appName })}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto space-y-4 min-h-[6rem]" data-testid="github-project-picker">
          {state.kind === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin theme-text-muted" />
            </div>
          )}

          {state.kind === 'authRequired' && (
            <div className="space-y-3">
              <p className="text-sm theme-text-muted">{t('githubProjectPicker.authRequired')}</p>
              <Button asChild size="sm">
                <a href={syncUrl}>
                  <Github className="w-4 h-4 mr-2" />
                  {t('githubProjectPicker.connectGithub')}
                </a>
              </Button>
            </div>
          )}

          {state.kind === 'error' && (
            <div className="space-y-3">
              <p className="text-sm theme-text-muted">{t('githubProjectPicker.loadError')}</p>
              <Button variant="outline" size="sm" onClick={reload}>
                <RefreshCw className="w-4 h-4 mr-2" />
                {t('githubProjectPicker.retry')}
              </Button>
            </div>
          )}

          {state.kind === 'ready' && state.installations.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm theme-text-muted">{t('githubProjectPicker.noOrganizations')}</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href={installUrl}>
                    <Github className="w-4 h-4 mr-2" />
                    {t('githubProjectPicker.installOnOrg')}
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={syncUrl}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {t('githubProjectPicker.refreshAccess')}
                  </a>
                </Button>
              </div>
            </div>
          )}

          {state.kind === 'ready' &&
            state.installations.map(installation => (
              <section key={installation.installationId} className="space-y-2">
                <h3 className="text-sm font-medium theme-text-primary flex items-center gap-2">
                  <Building2 className="w-4 h-4 theme-text-muted" />
                  <span className="break-all">{installation.accountLogin}</span>
                </h3>
                {installation.projects.length === 0 ? (
                  <p className="text-sm theme-text-muted pl-6">{t('githubProjectPicker.noProjects')}</p>
                ) : (
                  <ul className="space-y-2">
                    {installation.projects.map(project => (
                      <li
                        key={project.nodeId}
                        data-project-node-id={project.nodeId}
                        data-closed={project.closed ? 'true' : 'false'}
                        className={`rounded-lg border theme-border p-3 flex flex-wrap items-center justify-between gap-2 ${
                          project.closed ? 'opacity-60' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium theme-text-primary break-words">{project.title}</div>
                          <div className="text-xs theme-text-muted">
                            #{project.number}
                            {' · '}
                            {project.itemCount === 1
                              ? t('githubProjectPicker.itemCountOne')
                              : t('githubProjectPicker.itemCountMany', { count: String(project.itemCount) })}
                            {project.closed && ` · ${t('githubProjectPicker.closed')}`}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={project.boundProjectId ? 'outline' : 'default'}
                          disabled={binding !== null || (Boolean(project.boundProjectId) && !project.boundListId)}
                          onClick={() => void choose(installation, project)}
                        >
                          {binding === project.nodeId && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                          {project.boundProjectId ? t('githubProjectPicker.openBoard') : t('githubProjectPicker.connect')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
        </div>

        {state.kind === 'ready' && state.installations.length > 0 && (
          <div className="flex flex-wrap gap-3 pt-2 border-t theme-border text-sm">
            <a href={installUrl} className="inline-flex items-center gap-1 text-blue-500 hover:underline">
              <ExternalLink className="w-3.5 h-3.5" />
              {t('githubProjectPicker.installAnother')}
            </a>
            <a href={syncUrl} className="inline-flex items-center gap-1 theme-text-muted hover:underline">
              <RefreshCw className="w-3.5 h-3.5" />
              {t('githubProjectPicker.refreshAccess')}
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
