'use client'

/**
 * Admin enrollment of business runtime bindings (AWTD-1668).
 *
 * The list of bindings, their state, the lifecycle actions available right now,
 * attach/detach for allowed boards, and a small enrollment form. The rules live
 * on the server (lib/runtime-binding/enrollment.ts); this page offers only the
 * actions the server reports as available and shows the server's explanation
 * when it refuses, such as a held board conflict.
 *
 * The pilot is fixed (polling, concurrency one, business payer, Jon 2026-11-14),
 * so the form does not ask for those. Wider configurations go through the API.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslations } from '@/lib/i18n/client'
import { apiDelete, apiGet, apiPost, refusalReason } from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RUNTIME_KINDS, type RuntimeBindingAction } from '@/lib/runtime-binding/enrollment-rules'
import {
  PILOT_BILLING_SOURCE,
  PILOT_MAX_CONCURRENT_RUNS,
  PILOT_SCOPE,
  PILOT_TRANSPORT,
} from '@/lib/runtime-binding/pilot'

const ENDPOINT = '/api/v1/admin/runtime-bindings'

interface BindingRow {
  id: string
  state: string
  revision: number
  approvedRevision: number | null
  runtimeKind: string
  runtimeSubjectId: string
  transport: string
  allowedAgentIds: string[]
  allowedBoardIds: string[]
}

interface BindingView {
  binding: BindingRow
  attachedBoards: Array<{ id: string; name: string }>
  availableActions: RuntimeBindingAction[]
}

const STATE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  verified: 'secondary',
  pending: 'outline',
  suspended: 'secondary',
  revoked: 'destructive',
}

const splitIds = (value: string) => value.split(',').map(part => part.trim()).filter(Boolean)

export default function RuntimeBindingsAdminPage() {
  const { t } = useTranslations()
  const [views, setViews] = useState<BindingView[] | null>(null)
  const [enrollmentEnabled, setEnrollmentEnabled] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      apiGet(ENDPOINT)
        .then(response => response.json())
        .then(data => {
          setViews(data.bindings ?? [])
          setEnrollmentEnabled(!!data.enrollmentEnabled)
          setLoadFailed(false)
        })
        .catch(() => setLoadFailed(true)),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const run = async (write: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await write()
      toast.success(t('admin.runtimeBindings.saved'))
      await load()
    } catch (error) {
      toast.error(refusalReason(error) ?? t('admin.runtimeBindings.failed'))
    } finally {
      setBusy(false)
    }
  }

  const act = (id: string, action: RuntimeBindingAction, revision: number) => {
    if (action === 'revoke' && !confirm(t('admin.runtimeBindings.confirmRevoke'))) return
    void run(() => apiPost(`${ENDPOINT}/${id}/lifecycle`, { action, expectedRevision: revision }))
  }

  if (loadFailed) {
    return <div className="container mx-auto p-8 text-danger">{t('admin.runtimeBindings.loadFailed')}</div>
  }
  if (!views) {
    return <div className="flex min-h-screen items-center justify-center">{t('admin.runtimeBindings.loading')}</div>
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-4 px-4 py-6 sm:py-8">
      <header className="border-b py-3">
        <h1 className="text-2xl font-bold">{t('admin.nav.runtimeBindings')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.runtimeBindings.description')}</p>
      </header>

      {!enrollmentEnabled && (
        <Card><CardContent className="py-4 text-sm text-muted-foreground">
          {t('admin.runtimeBindings.gateOff')}
        </CardContent></Card>
      )}

      {views.length === 0 && (
        <Card><CardContent className="py-8 text-center text-muted-foreground">
          {t('admin.runtimeBindings.empty')}
        </CardContent></Card>
      )}

      {views.map(view => (
        <BindingCard key={view.binding.id} view={view} busy={busy} onAction={act} onRun={run} />
      ))}

      {enrollmentEnabled && <EnrollForm busy={busy} onRun={run} />}
    </div>
  )
}

function BindingCard({
  view,
  busy,
  onAction,
  onRun,
}: {
  view: BindingView
  busy: boolean
  onAction: (id: string, action: RuntimeBindingAction, revision: number) => void
  onRun: (write: () => Promise<unknown>) => Promise<void>
}) {
  const { t } = useTranslations()
  const { binding, attachedBoards, availableActions } = view
  const attachedIds = new Set(attachedBoards.map(board => board.id))
  const attachable = binding.state === 'revoked' ? [] : binding.allowedBoardIds.filter(id => !attachedIds.has(id))
  const approved = binding.approvedRevision === binding.revision

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-lg">{binding.runtimeSubjectId}</CardTitle>
            <CardDescription>
              {t('admin.runtimeBindings.revision', { revision: String(binding.revision) })}
              {' · '}
              {approved ? t('admin.runtimeBindings.approved') : t('admin.runtimeBindings.notApproved')}
            </CardDescription>
          </div>
          <Badge variant={STATE_VARIANT[binding.state] ?? 'outline'}>
            {t(`admin.runtimeBindings.states.${binding.state}`)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">{t('admin.runtimeBindings.runtime')}</dt>
          <dd>{binding.runtimeKind} · {binding.transport}</dd>
          <dt className="text-muted-foreground">{t('admin.runtimeBindings.agents')}</dt>
          <dd className="break-all">{binding.allowedAgentIds.join(', ')}</dd>
        </dl>

        <div className="space-y-2">
          <div className="text-muted-foreground">{t('admin.runtimeBindings.boards')}</div>
          {attachedBoards.map(board => (
            <div key={board.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{board.name}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void onRun(() => apiDelete(`${ENDPOINT}/${binding.id}/boards?boardId=${encodeURIComponent(board.id)}`))}
              >
                {t('admin.runtimeBindings.detach')}
              </Button>
            </div>
          ))}
          {attachable.map(boardId => (
            <div key={boardId} className="flex items-center justify-between gap-2">
              <span className="truncate text-muted-foreground">{boardId}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void onRun(() => apiPost(`${ENDPOINT}/${binding.id}/boards`, { boardId }))}
              >
                {t('admin.runtimeBindings.attach')}
              </Button>
            </div>
          ))}
        </div>

        {availableActions.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {availableActions.map(action => (
              <Button
                key={action}
                size="sm"
                variant={action === 'revoke' ? 'destructive' : action === 'suspend' ? 'secondary' : 'default'}
                disabled={busy}
                onClick={() => onAction(binding.id, action, binding.revision)}
              >
                {t(`admin.runtimeBindings.actions.${action}`)}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function EnrollForm({ busy, onRun }: { busy: boolean; onRun: (write: () => Promise<unknown>) => Promise<void> }) {
  const { t } = useTranslations()
  const [runtimeKind, setRuntimeKind] = useState<string>('business-machine')
  const [fields, setFields] = useState({
    runtimeSubjectId: '',
    allowedAgentIds: '',
    allowedBoardIds: '',
    allowedRepositoryRefs: '',
    credentialRef: '',
    billingAccountRef: '',
  })
  const set = (key: keyof typeof fields) => (event: { target: { value: string } }) =>
    setFields(prev => ({ ...prev, [key]: event.target.value }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void onRun(() =>
      apiPost(ENDPOINT, {
        managementScope: PILOT_SCOPE,
        runtimeKind,
        runtimeSubjectId: fields.runtimeSubjectId.trim(),
        allowedAgentIds: splitIds(fields.allowedAgentIds),
        allowedBoardIds: splitIds(fields.allowedBoardIds),
        allowedRepositoryRefs: splitIds(fields.allowedRepositoryRefs),
        transport: PILOT_TRANSPORT,
        maxConcurrentRuns: PILOT_MAX_CONCURRENT_RUNS,
        billingSource: PILOT_BILLING_SOURCE,
        credentialRef: fields.credentialRef.trim() || null,
        billingAccountRef: fields.billingAccountRef.trim() || null,
      }),
    )
  }

  const textFields: Array<keyof typeof fields> = [
    'runtimeSubjectId',
    'allowedAgentIds',
    'allowedBoardIds',
    'allowedRepositoryRefs',
    'credentialRef',
    'billingAccountRef',
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('admin.runtimeBindings.enrollTitle')}</CardTitle>
        <CardDescription>{t('admin.runtimeBindings.enrollDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="rb-runtimeKind">{t('admin.runtimeBindings.fields.runtimeKind')}</Label>
            <select
              id="rb-runtimeKind"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={runtimeKind}
              onChange={event => setRuntimeKind(event.target.value)}
            >
              {RUNTIME_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
            </select>
          </div>
          {textFields.map(key => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`rb-${key}`}>{t(`admin.runtimeBindings.fields.${key}`)}</Label>
              <Input id={`rb-${key}`} value={fields[key]} onChange={set(key)} autoComplete="off" />
            </div>
          ))}
          <p className="text-xs text-muted-foreground sm:col-span-2">{t('admin.runtimeBindings.commaHint')}</p>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>{t('admin.runtimeBindings.enroll')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
