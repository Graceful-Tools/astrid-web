"use client"

import { BRAND } from '@/lib/brand/config'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Trash2, Plus, Key, Copy, Check, AlertTriangle, FlaskConical, Pencil, ShieldPlus } from 'lucide-react'
import { OAUTH_SCOPES, SCOPE_GROUPS, localizedScopeDescription, type OAuthScope } from '@/lib/oauth/oauth-scopes'
import {
  mergeOAuthRedirectUris,
  OAUTH_REDIRECT_PRESETS,
} from '@/lib/oauth/oauth-client-presets'
import { useTranslations } from '@/lib/i18n/client'
import { RichMessage, fillMessage } from '@/components/shared/RichMessage'
import { OAuthScopeGroupDialog } from '@/components/oauth-scope-group-dialog'
import { OAuthClientEditDialog } from '@/components/oauth-client-edit-dialog'
import { OAuthClientGuide, GRANT_TYPE_OPTIONS } from '@/components/oauth-client-guide'
import type { GrantType } from '@/types/oauth'
import { toast } from '@/hooks/use-toast'

interface OAuthClient {
  id: string
  clientId: string
  name: string
  description: string | null
  redirectUris: string[]
  scopes: OAuthScope[]
  /**
   * Which SCOPE_GROUPS entry this connection follows, or null for a bespoke
   * one. A connection with a group is topped up to it on every token request;
   * one without never changes (AWTD-962).
   */
  scopeGroup: string | null
  grantTypes: string[]
  isActive: boolean
  createdAt: string
  lastUsedAt: string | null
}

interface OAuthClientWithSecret extends OAuthClient {
  clientSecret: string
}

export function OAuthAppManager() {
  const router = useRouter()
  const { t } = useTranslations()
  const [clients, setClients] = useState<OAuthClient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create app dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newAppName, setNewAppName] = useState('')
  const [newAppDescription, setNewAppDescription] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<OAuthScope[]>([])
  const [selectedGrantTypes, setSelectedGrantTypes] = useState<GrantType[]>(['client_credentials'])
  const [redirectUrisInput, setRedirectUrisInput] = useState('')
  const [creating, setCreating] = useState(false)

  // New client credentials (shown once)
  const [newClientCredentials, setNewClientCredentials] = useState<OAuthClientWithSecret | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Test dialog state
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testingClient, setTestingClient] = useState<OAuthClient | null>(null)
  const [testClientSecret, setTestClientSecret] = useState('')
  const [obtainingToken, setObtainingToken] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<OAuthClient | null>(null)

  // Scope group adoption (AWTD-962) — the dialog owns the rest.
  const [scopeGroupDialogOpen, setScopeGroupDialogOpen] = useState(false)
  const [scopeGroupClient, setScopeGroupClient] = useState<OAuthClient | null>(null)

  useEffect(() => {
    loadClients()
  }, [])

  const loadClients = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/v1/oauth/clients')
      if (!response.ok) throw new Error(t('settingsPages.apiAccess.apps.errors.loadFailed'))

      const data = await response.json()
      setClients(data.clients)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsPages.apiAccess.apps.errors.loadClientsFailed'))
    } finally {
      setLoading(false)
    }
  }

  const createClient = async () => {
    if (!newAppName.trim()) {
      setError(t('settingsPages.apiAccess.apps.errors.nameRequired'))
      return
    }

    if (selectedScopes.length === 0) {
      setError(t('settingsPages.apiAccess.apps.errors.scopeRequired'))
      return
    }

    if (selectedGrantTypes.length === 0) {
      setError(t('settingsPages.apiAccess.apps.errors.grantRequired'))
      return
    }

    const redirectUris = redirectUrisInput
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)

    if (selectedGrantTypes.includes('authorization_code') && redirectUris.length === 0) {
      setError(t('settingsPages.apiAccess.apps.errors.redirectRequired'))
      return
    }

    const invalidRedirect = redirectUris.find(uri => {
      try {
        const parsed = new URL(uri)
        return parsed.protocol !== 'http:' && parsed.protocol !== 'https:'
      } catch {
        return true
      }
    })

    if (invalidRedirect) {
      setError(fillMessage(t('settingsPages.apiAccess.apps.errors.invalidRedirect'), { uri: invalidRedirect }))
      return
    }

    try {
      setCreating(true)
      setError(null)

      const response = await fetch('/api/v1/oauth/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAppName,
          description: newAppDescription || null,
          scopes: selectedScopes,
          grantTypes: selectedGrantTypes,
          redirectUris: redirectUris.length ? redirectUris : undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || t('settingsPages.apiAccess.apps.errors.createFailed'))
      }

      const data = await response.json()
      setNewClientCredentials(data.client)

      // Reset form
      setNewAppName('')
      setNewAppDescription('')
      setSelectedScopes([])
      setSelectedGrantTypes(['client_credentials'])
      setRedirectUrisInput('')
      setCreateDialogOpen(false)

      // Reload clients
      await loadClients()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsPages.apiAccess.apps.errors.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  const deleteClient = async (clientId: string) => {
    if (!confirm(t('settingsPages.apiAccess.apps.deleteConfirm'))) return

    try {
      const response = await fetch(`/api/v1/oauth/clients/${clientId}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error(t('settingsPages.apiAccess.apps.errors.deleteFailed'))

      await loadClients()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsPages.apiAccess.apps.errors.deleteFailed'))
    }
  }

  const regenerateSecret = async (clientId: string) => {
    if (!confirm(t('settingsPages.apiAccess.apps.regenerateConfirm'))) return

    try {
      const response = await fetch(`/api/v1/oauth/clients/${clientId}/regenerate-secret`, {
        method: 'POST',
      })

      if (!response.ok) throw new Error(t('settingsPages.apiAccess.apps.errors.regenerateFailed'))

      const data = await response.json()
      // Show new secret
      const client = clients.find(c => c.clientId === clientId)
      if (client) {
        setNewClientCredentials({
          ...client,
          clientSecret: data.clientSecret,
        } as OAuthClientWithSecret)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsPages.apiAccess.apps.errors.regenerateFailed'))
    }
  }

  const copyToClipboard = async (text: string, field: string) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        setCopiedField(field)
        setTimeout(() => setCopiedField(null), 2000)
        toast.success(t('common.copiedToClipboard'))
      } else {
        // Fallback for localhost/non-HTTPS
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
        setCopiedField(field)
        setTimeout(() => setCopiedField(null), 2000)
        toast.success(t('common.copiedToClipboard'))
      }
    } catch (err) {
      console.error('Failed to copy:', err)
      toast.error(t('settingsPages.apiAccess.apps.errors.copyFailed'))
    }
  }

  const toggleScope = (scope: OAuthScope) => {
    setSelectedScopes(prev =>
      prev.includes(scope)
        ? prev.filter(s => s !== scope)
        : [...prev, scope]
    )
  }

  const selectScopeGroup = (group: keyof typeof SCOPE_GROUPS) => {
    setSelectedScopes(SCOPE_GROUPS[group] as OAuthScope[])
  }

  const toggleGrantType = (grant: GrantType) => {
    setSelectedGrantTypes(prev => {
      const exists = prev.includes(grant)
      if (exists) {
        let next = prev.filter(g => g !== grant)
        if (grant === 'authorization_code') {
          next = next.filter(g => g !== 'refresh_token')
        }
        if (grant === 'refresh_token' && !next.includes('authorization_code')) {
          next = next.filter(g => g !== 'refresh_token')
        }
        if (!next.length) {
          return prev
        }
        return next
      }

      let next = [...prev, grant]

      if (grant === 'authorization_code' && !next.includes('refresh_token')) {
        next.push('refresh_token')
      }

      if (grant === 'refresh_token' && !next.includes('authorization_code')) {
        next.push('authorization_code')
      }

      return Array.from(new Set(next))
    })
  }

  const openScopeGroupDialog = (client: OAuthClient) => { setScopeGroupClient(client); setScopeGroupDialogOpen(true) }

  const openTestDialog = (client: OAuthClient) => {
    // Navigate directly to testing page with client ID pre-filled
    router.push(`/settings/api-testing?clientId=${encodeURIComponent(client.clientId)}&clientName=${encodeURIComponent(client.name)}`)
  }

  const openEditDialog = (client: OAuthClient) => {
    setEditingClient(client)
    setEditDialogOpen(true)
  }

  const testOAuthApp = async () => {
    if (!testingClient || !testClientSecret) {
      setError(t('settingsPages.apiAccess.apps.errors.secretRequired'))
      return
    }

    try {
      setObtainingToken(true)
      setError(null)

      // Obtain access token
      const response = await fetch('/api/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: testingClient.clientId,
          client_secret: testClientSecret,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || t('settingsPages.apiAccess.apps.errors.tokenFailed'))
      }

      const data = await response.json()
      const accessToken = data.access_token

      // Close dialog
      setTestDialogOpen(false)
      setTestClientSecret('')

      // Navigate to testing page with token
      router.push(`/settings/api-testing?token=${encodeURIComponent(accessToken)}`)

      toast.success(t('settingsPages.apiAccess.apps.tokenObtained'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsPages.apiAccess.apps.errors.tokenFailedShort'))
      toast.error(err instanceof Error ? err.message : t('settingsPages.apiAccess.apps.errors.tokenFailedShort'))
    } finally {
      setObtainingToken(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8">{t('settingsPages.apiAccess.apps.loading')}</div>
  }

  return (
    <div className="space-y-6">
      {/* Error Display */}
      {error && (
        <Card className="border-danger bg-danger-subtle">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-2 text-danger">
              <AlertTriangle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Client Credentials Dialog */}
      {newClientCredentials && (
        <Dialog open={!!newClientCredentials} onOpenChange={() => setNewClientCredentials(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('settingsPages.apiAccess.apps.createdTitle')}</DialogTitle>
              <DialogDescription>
                {t('settingsPages.apiAccess.apps.saveCredentialsNow')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label>{t('settingsPages.customAgents.credentials.clientId')}</Label>
                <div className="flex items-center space-x-2 mt-1">
                  <Input
                    value={newClientCredentials.clientId}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(newClientCredentials.clientId, 'id')}
                  >
                    {copiedField === 'id' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <div>
                <Label>{t('settingsPages.customAgents.credentials.clientSecret')}</Label>
                <div className="flex items-center space-x-2 mt-1">
                  <Input
                    value={newClientCredentials.clientSecret}
                    readOnly
                    className="font-mono text-sm"
                    type="password"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(newClientCredentials.clientSecret, 'secret')}
                  >
                    {copiedField === 'secret' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-sm text-danger mt-2">
                  {t('settingsPages.apiAccess.apps.secretShownOnce')}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setNewClientCredentials(null)}>
                  {t('common.close')}
                </Button>
                <Button
                  onClick={async () => {
                    setObtainingToken(true)
                    try {
                      const response = await fetch('/api/v1/oauth/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          grant_type: 'client_credentials',
                          client_id: newClientCredentials.clientId,
                          client_secret: newClientCredentials.clientSecret,
                        }),
                      })

                      if (!response.ok) {
                        const error = await response.json()
                        throw new Error(error.error || t('settingsPages.apiAccess.apps.errors.tokenFailed'))
                      }

                      const data = await response.json()
                      const accessToken = data.access_token

                      setNewClientCredentials(null)
                      router.push(`/settings/api-testing?token=${encodeURIComponent(accessToken)}`)
                      toast.success(t('settingsPages.apiAccess.apps.tokenObtained'))
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : t('settingsPages.apiAccess.apps.errors.tokenFailedShort'))
                    } finally {
                      setObtainingToken(false)
                    }
                  }}
                  disabled={obtainingToken}
                >
                  {obtainingToken ? (
                    t('settingsPages.apiAccess.apps.obtainingToken')
                  ) : (
                    <>
                      <FlaskConical className="w-4 h-4 mr-2" />
                      {t('settingsPages.apiAccess.apps.testNow')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold theme-text-primary">{t('settingsPages.apiAccess.apps.heading')}</h2>
          <p className="theme-text-muted">{t('settingsPages.apiAccess.apps.subtitle')}</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          {t('settingsPages.apiAccess.apps.newApp')}
        </Button>
      </div>

      <OAuthClientGuide />

      {/* Client List */}
      {clients.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="theme-text-muted mb-4">{t('settingsPages.apiAccess.apps.empty')}</p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              {t('settingsPages.apiAccess.apps.createFirst')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {clients.map(client => (
            <Card key={client.id}>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <CardTitle>{client.name}</CardTitle>
                    {client.description && (
                      <CardDescription>{client.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => openTestDialog(client)}
                    >
                      <FlaskConical className="w-4 h-4 mr-2" />
                      {t('settingsPages.apiAccess.apps.test')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openEditDialog(client)}
                    >
                      <Pencil className="w-4 h-4 mr-2" />
                      {t('common.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openScopeGroupDialog(client)}
                    >
                      <ShieldPlus className="w-4 h-4 mr-2" />
                      {t('settingsPages.connections.permissions.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => regenerateSecret(client.clientId)}
                    >
                      <Key className="w-4 h-4 mr-2" />
                      {t('settingsPages.apiAccess.apps.regenerate')}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteClient(client.clientId)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs">{t('settingsPages.customAgents.credentials.clientId')}</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-sm theme-bg-tertiary px-2 py-1 rounded flex-1 font-mono break-all">
                      {client.clientId}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyToClipboard(client.clientId, client.clientId)}
                    >
                      {copiedField === client.clientId ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-xs">{t('settingsPages.connections.columns.scopes')}</Label>
                    {client.scopeGroup ? (
                      <Badge variant="outline" className="text-xs">
                        {t('settingsPages.apiAccess.apps.followsGroup', { group: client.scopeGroup })}
                      </Badge>
                    ) : (
                      <span className="text-xs theme-text-muted">{t('settingsPages.apiAccess.apps.fixedAtCreation')}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {client.scopes.map(scope => (
                      <Badge key={scope} variant="secondary" className="text-xs">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs">{t('settingsPages.apiAccess.apps.grantTypes')}</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {client.grantTypes.map(grant => (
                      <Badge key={grant} variant="outline" className="text-xs">
                        {grant}
                      </Badge>
                    ))}
                  </div>
                </div>

                {client.redirectUris.length > 0 && (
                  <div>
                    <Label className="text-xs">{t('settingsPages.apiAccess.apps.redirectUris')}</Label>
                    <div className="mt-1 space-y-1">
                      {client.redirectUris.map(uri => (
                        <div key={uri} className="text-xs font-mono theme-bg-tertiary rounded px-2 py-1 break-all">
                          {uri}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs theme-text-muted">
                  <span>{t('settingsPages.apiAccess.apps.created', { date: new Date(client.createdAt).toLocaleDateString() })}</span>
                  {client.lastUsedAt && (
                    <span>{t('settingsPages.apiAccess.apps.lastUsed', { date: new Date(client.lastUsedAt).toLocaleDateString() })}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Test OAuth App Dialog */}
      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settingsPages.apiAccess.apps.testTitle')}</DialogTitle>
            <DialogDescription>
              {t('settingsPages.apiAccess.apps.testDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>{t('settingsPages.connections.permissions.application')}</Label>
              <Input
                value={testingClient?.name || ''}
                readOnly
                className="bg-theme-secondary"
              />
            </div>

            <div>
              <Label>{t('settingsPages.customAgents.credentials.clientId')}</Label>
              <Input
                value={testingClient?.clientId || ''}
                readOnly
                className="font-mono text-sm bg-theme-secondary"
              />
            </div>

            <div>
              <Label htmlFor="test-secret">{t('settingsPages.apiAccess.apps.clientSecretRequired')}</Label>
              <Input
                id="test-secret"
                type="password"
                value={testClientSecret}
                onChange={(e) => setTestClientSecret(e.target.value)}
                placeholder={t('settingsPages.apiAccess.apps.secretPlaceholder')}
                className="font-mono text-sm"
              />
              <p className="text-xs theme-text-muted mt-1">
                {t('settingsPages.apiAccess.apps.secretHint')}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setTestDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={testOAuthApp} disabled={obtainingToken || !testClientSecret}>
                {obtainingToken ? t('settingsPages.apiAccess.apps.obtainingToken') : t('settingsPages.aiIntegrations.step2.testApiButton')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create App Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('settingsPages.apiAccess.apps.createTitle')}</DialogTitle>
            <DialogDescription>
              {t('settingsPages.apiAccess.apps.createDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="app-name">{t('settingsPages.apiAccess.apps.nameLabel')}</Label>
              <Input
                id="app-name"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                placeholder={t('settingsPages.apiAccess.apps.namePlaceholder')}
              />
            </div>

            <div>
              <Label htmlFor="app-description">{t('settingsPages.apiAccess.apps.descriptionLabel')}</Label>
              <Input
                id="app-description"
                value={newAppDescription}
                onChange={(e) => setNewAppDescription(e.target.value)}
                placeholder={t('settingsPages.apiAccess.apps.descriptionPlaceholder')}
              />
            </div>

            <div>
              <Label>{t('settingsPages.apiAccess.apps.scopesRequired')}</Label>
              <div className="space-y-2 mt-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectScopeGroup('mobile_app')}
                  >
                    {t('settingsPages.apiAccess.apps.mobileFullAccess')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectScopeGroup('readonly')}
                  >
                    {t('settingsPages.apiAccess.apps.readOnly')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectScopeGroup('ai_agent')}
                  >
                    {t('settingsPages.apiAccess.apps.aiAgentPreset')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedScopes([])}
                  >
                    {t('common.clearAll')}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                  {Object.entries(OAUTH_SCOPES).filter(([scope]) => scope !== '*').map(([scope]) => (
                    <div key={scope} className="flex items-center space-x-2">
                      <Checkbox
                        id={scope}
                        checked={selectedScopes.includes(scope as OAuthScope)}
                        onCheckedChange={() => toggleScope(scope as OAuthScope)}
                      />
                      <label
                        htmlFor={scope}
                        className="text-sm cursor-pointer flex-1"
                      >
                        <code className="text-xs">{scope}</code>
                        <span className="text-xs theme-text-muted block">{localizedScopeDescription(scope, t)}</span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <Label>{t('settingsPages.apiAccess.apps.grantTypesRequired')}</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {GRANT_TYPE_OPTIONS.map(option => (
                  <div key={option.value} className="flex items-start space-x-2">
                    <Checkbox
                      id={`grant-${option.value}`}
                      checked={selectedGrantTypes.includes(option.value)}
                      onCheckedChange={() => toggleGrantType(option.value)}
                    />
                    <label htmlFor={`grant-${option.value}`} className="text-sm cursor-pointer">
                      <div className="font-medium">{t(option.labelKey)}</div>
                      <p className="text-xs theme-text-muted">{t(option.descriptionKey)}</p>
                    </label>
                  </div>
                ))}
              </div>
              <p className="text-xs theme-text-muted mt-2">
                <RichMessage message={t('settingsPages.apiAccess.apps.grantHelp')} values={{ code: <code className="px-1 theme-bg-tertiary rounded text-caption2">authorization_code</code> }} />
              </p>
            </div>

            <div>
              <Label htmlFor="redirect-uris">{t('settingsPages.apiAccess.apps.redirectUris')}</Label>
              <Textarea
                id="redirect-uris"
                value={redirectUrisInput}
                onChange={(e) => setRedirectUrisInput(e.target.value)}
                placeholder="https://chat.openai.com/aip/api/v1/oauth/callback"
                className="mt-1 font-mono text-sm"
                rows={3}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setRedirectUrisInput(current =>
                    mergeOAuthRedirectUris(current, OAUTH_REDIRECT_PRESETS.vscodeCopilot)
                  )
                  setSelectedGrantTypes(current =>
                    current.includes('authorization_code')
                      ? current
                      : [...current, 'authorization_code']
                  )
                }}
              >
                {t('settingsPages.aiIntegrations.mcp.vscodeTitle')}
              </Button>
              <p className="text-xs theme-text-muted mt-2">
                {t('settingsPages.apiAccess.apps.redirectHelp', { appName: BRAND.appName })}
              </p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={createClient} disabled={creating}>
                {creating ? t('settingsPages.apiAccess.apps.creating') : t('settingsPages.apiAccess.apps.createApplication')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <OAuthScopeGroupDialog
        client={scopeGroupClient}
        open={scopeGroupDialogOpen}
        onOpenChange={(open) => {
          setScopeGroupDialogOpen(open)
          if (!open) setScopeGroupClient(null)
        }}
        onUpdated={loadClients}
      />

      <OAuthClientEditDialog
        client={editingClient}
        open={editDialogOpen}
        onOpenChange={(open) => {
          setEditDialogOpen(open)
          if (!open) setEditingClient(null)
        }}
        onUpdated={loadClients}
        onEditScopes={() => { if (editingClient) openScopeGroupDialog(editingClient); setEditDialogOpen(false) }}
      />
    </div>
  )
}
