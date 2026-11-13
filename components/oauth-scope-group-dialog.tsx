"use client"

/**
 * Edit exactly what an OAuth connection may do: one checkbox per scope, plus
 * the scope group it follows (AWTD-962, made granular by AWTD-1513).
 *
 * WHY THE GROUP. `reconcileClientScopes` tops a client up to its group on
 * every token request, but its first bound is "no group, no change" — so it
 * does nothing until something records the group, and on 2026-09-19 every one
 * of the 23 `OAuthClient` rows in production carried `scopeGroup: null`. A
 * connection created here in Settings is reachable from none of the code paths
 * that stamp one. Following a group is how such a connection picks up a scope
 * added later (e.g. `lists:configure`) without a hand-written UPDATE against
 * the production row — the manual grant Jon rejected on 2026-09-16.
 *
 * WHY THE CHECKBOXES. Jon, AWTD-1513: "the scope edit cards didn't enable
 * granular editing of scopes." A whole-group radio could only ever widen.
 * Now the owner ticks the exact set; the scopes a group would grant but the
 * connection does not hold yet are marked, so a newly added scope is visible
 * rather than inferred.
 *
 * The two interact: a scope unticked from the followed group would be put
 * back by reconciliation on the next token request, so unticking one stops
 * following the group (the server applies the same rule, so an API caller
 * cannot save a set that silently reverts). The server is the only judge of
 * which scope names are real — this sends names, it does not vouch for them.
 *
 * It lives in its own file because `oauth-app-manager.tsx` is on the
 * oversized-files ratchet (task 9377bc2c).
 */

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  localizedScopeDescription,
  SCOPE_GROUPS,
  getAllScopes,
  isRegisterableScope,
  isScopeGroup,
  type ScopeGroup,
} from '@/lib/oauth/oauth-scopes'
import { apiCall, refusalReason } from '@/lib/api'
import { useTranslations } from '@/lib/i18n/client'
import { toast } from '@/hooks/use-toast'

const PREFIX = 'settingsPages.connections.permissions'

/** Every scope an owner may grant, in the canonical order of OAUTH_SCOPES. */
const ASSIGNABLE = getAllScopes()

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
  const { t } = useTranslations()
  const [chosen, setChosen] = useState<ScopeGroup | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  // Leaving the group regroups the list, which remounts every checkbox; this
  // puts keyboard focus back on the one that was just unticked.
  const refocus = useRef<string | null>(null)

  useEffect(() => {
    if (!refocus.current) return
    document.getElementById(`scope-edit-${refocus.current}`)?.focus()
    refocus.current = null
  }, [chosen])

  // Start from what the connection holds and the group it already follows —
  // never a proposed group, which would pre-tick scopes nobody asked for. A
  // followed group's scopes start ticked even where not yet granted: the next
  // token request grants them anyway, so an unticked box would misstate what
  // the connection is about to hold. The "not granted yet" badge marks them.
  useEffect(() => {
    if (!client) return
    const group = isScopeGroup(client.scopeGroup) ? client.scopeGroup : null
    setChosen(group)
    setSelected(new Set([...client.scopes.filter(isRegisterableScope), ...(group ? SCOPE_GROUPS[group] : [])]))
  }, [client])

  const close = () => onOpenChange(false)

  const follow = (group: ScopeGroup | null) => {
    setChosen(group)
    // Following a group grants everything in it — show that before saving.
    if (group) setSelected(prev => new Set([...prev, ...SCOPE_GROUPS[group]]))
  }

  const toggle = (scope: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(scope)) next.delete(scope)
      else next.add(scope)
      return next
    })
    // Reconciliation would put an unticked group scope straight back.
    if (chosen && selected.has(scope) && (SCOPE_GROUPS[chosen] as readonly string[]).includes(scope)) {
      refocus.current = scope
      setChosen(null)
    }
  }

  const apply = async () => {
    if (!client) return
    const scopes = ASSIGNABLE.filter(scope => selected.has(scope))

    try {
      setSaving(true)
      // apiCall, not apiPut: apiPut routes through the offline-aware queue, and
      // a privilege change that replays later out of a queue is not what
      // anyone pressing this button is asking for. Throws ApiError on a 4xx.
      const response = await apiCall(`/api/v1/oauth/clients/${client.clientId}`, {
        method: 'PUT',
        body: JSON.stringify({ scopes, scopeGroup: chosen }),
      })
      const data = await response.json()

      // Say what actually changed, read off the row the server saved. "Saved"
      // on a no-op reads as a grant that did not happen, which is how this
      // entire class of bug went unnoticed.
      const saved: string[] = Array.isArray(data.client?.scopes) ? data.client.scopes : scopes
      const before = new Set(client.scopes)
      const after = new Set(saved)
      const added = saved.filter(scope => !before.has(scope))
      const removed = client.scopes.filter(scope => !after.has(scope))
      // The group is a change too: following one, or stopping, can leave
      // today's scopes untouched and still alter what the connection gets later.
      const savedGroup: string | null =
        data.client && 'scopeGroup' in data.client ? data.client.scopeGroup : chosen
      const groupChanged = (savedGroup ?? null) !== (client.scopeGroup ?? null)
      const parts = [
        added.length ? t(`${PREFIX}.savedAdded`, { scopes: added.join(', ') }) : null,
        removed.length ? t(`${PREFIX}.savedRemoved`, { scopes: removed.join(', ') }) : null,
        groupChanged
          ? savedGroup
            ? t(`${PREFIX}.savedGroup`, { group: savedGroup })
            : t(`${PREFIX}.savedNoGroup`)
          : null,
      ].filter(Boolean)
      toast.success(
        parts.length ? `${parts.join(' ')} ${t(`${PREFIX}.tokensNote`)}` : t(`${PREFIX}.unchanged`),
      )

      close()
      await onUpdated()
    } catch (err) {
      console.error('Failed to update connection scopes:', err)
      // refusalReason surfaces the server's own 4xx sentence — an unknown
      // scope, a client the caller does not own — and nothing from a 5xx.
      toast.error(refusalReason(err) ?? t(`${PREFIX}.saveError`))
    } finally {
      setSaving(false)
    }
  }

  const groupScopes: readonly string[] = chosen ? SCOPE_GROUPS[chosen] : []
  const held = new Set(client?.scopes ?? [])
  const sections = chosen
    ? [
        { key: 'group', title: t(`${PREFIX}.inGroup`, { group: chosen }), scopes: ASSIGNABLE.filter(s => groupScopes.includes(s)) },
        { key: 'other', title: t(`${PREFIX}.otherScopes`), scopes: ASSIGNABLE.filter(s => !groupScopes.includes(s)) },
      ]
    : [{ key: 'all', title: t(`${PREFIX}.scopes`), scopes: ASSIGNABLE }]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        A column with ONE scrolling child, not a tall box.

        `DialogContent` is fixed, centred with translate-y(-50%), and caps
        nothing: at 390x664 this dialog rendered 836px tall with its top at
        -86 and its bottom at 750, the page unscrollable and no scroll
        container inside it. Every button — including the ✕ — was off-screen,
        so on a phone the thing could not be used OR dismissed (measured, not
        guessed). `max-h` alone would have let it scroll but pushed the
        actions off the bottom, so the footer is pinned outside the scroller
        and only the middle moves.

        `dvh` where supported: on mobile Safari `vh` means the viewport with
        the browser chrome HIDDEN, which is exactly the case this bug is about.
      */}
      <DialogContent className="max-w-xl flex flex-col max-h-[85vh] supports-[height:100dvh]:max-h-[85dvh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t(`${PREFIX}.title`)}</DialogTitle>
          <DialogDescription>{t(`${PREFIX}.description`)}</DialogDescription>
        </DialogHeader>

        {client ? (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
            <div>
              <Label>{t(`${PREFIX}.application`)}</Label>
              <Input value={client.name} readOnly className="bg-theme-secondary" />
            </div>

            <div className="space-y-2">
              <Label>{t(`${PREFIX}.follow`)}</Label>
              <label className="flex items-start gap-3 rounded border p-3 cursor-pointer">
                <input
                  type="radio"
                  name="scope-group"
                  className="mt-1"
                  checked={chosen === null}
                  onChange={() => follow(null)}
                />
                <span className="flex-1 text-sm">{t(`${PREFIX}.noGroup`)}</span>
              </label>
              {(Object.keys(SCOPE_GROUPS) as ScopeGroup[]).map(group => {
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
                      onChange={() => follow(group)}
                    />
                    <span className="flex-1">
                      <span className="font-mono text-sm">{group}</span>
                      {client.scopeGroup === group && (
                        <Badge variant="outline" className="ml-2 text-xs">{t(`${PREFIX}.current`)}</Badge>
                      )}
                      <span className="block text-xs theme-text-muted mt-1">
                        {wouldAdd.length
                          ? t(`${PREFIX}.groupAdds`, { scopes: wouldAdd.join(', ') })
                          : t(`${PREFIX}.groupAddsNothing`)}
                      </span>
                    </span>
                  </label>
                )
              })}
              {isScopeGroup(client.scopeGroup) && chosen !== client.scopeGroup && (
                <p className="text-xs text-warning">
                  {t(`${PREFIX}.leavesGroup`, { group: client.scopeGroup })}
                </p>
              )}
            </div>

            {sections.map(section => (
              <div key={section.key} className="space-y-2">
                <Label>{section.title}</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {section.scopes.map(scope => (
                    <div key={scope} data-scope={scope} className="flex items-start space-x-2">
                      <Checkbox
                        id={`scope-edit-${scope}`}
                        className="mt-0.5"
                        checked={selected.has(scope)}
                        onCheckedChange={() => toggle(scope)}
                      />
                      <label htmlFor={`scope-edit-${scope}`} className="text-sm cursor-pointer flex-1">
                        <code className="text-xs">{scope}</code>
                        {groupScopes.includes(scope) && !held.has(scope) && (
                          <Badge variant="outline" className="ml-2 text-caption2 text-warning">
                            {t(`${PREFIX}.notGranted`)}
                          </Badge>
                        )}
                        <span className="text-xs theme-text-muted block">{localizedScopeDescription(scope, t)}</span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <p className="text-xs theme-text-muted">{t(`${PREFIX}.tokensNote`)}</p>
            </div>

            {/* Outside the scroller: the actions stay put however long the list gets. */}
            <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
              {selected.size === 0 && (
                <span className="text-xs text-danger mr-auto">{t(`${PREFIX}.selectAtLeastOne`)}</span>
              )}
              <Button variant="outline" onClick={close}>{t('settingsPages.connections.cancel')}</Button>
              <Button onClick={apply} disabled={saving || selected.size === 0}>
                {saving ? t(`${PREFIX}.saving`) : t(`${PREFIX}.save`)}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm theme-text-muted">{t(`${PREFIX}.selectApp`)}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
