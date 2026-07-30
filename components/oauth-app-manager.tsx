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
import { Trash2, Plus, Key, Copy, Check, AlertTriangle, FlaskConical, Pencil } from 'lucide-react'
import { OAUTH_SCOPES, SCOPE_GROUPS, type OAuthScope } from '@/lib/oauth/oauth-scopes'
import type { GrantType } from '@/types/oauth'
import { toast } from 'sonner'

interface OAuthClient {
  id: string
  clientId: string
  name: string
  description: string | null
  redirectUris: string[]
  scopes: OAuthScope[]
  grantTypes: string[]
  isActive: boolean
  createdAt: string
  lastUsedAt: string | null
}

interface OAuthClientWithSecret extends OAuthClient {
  clientSecret: string
}

const GRANT_TYPE_OPTIONS: Array<{
  value: GrantType
  label: string
  description: string
}> = [
  {
    value: 'client_credentials',
    label: 'Client Credentials',
    description: 'Server-to-server access (no user login required)',
  },
  {
    value: 'authorization_code',
    label: 'Authorization Code',
    description: 'User consent via browser (ChatGPT, third-party apps)',
  },
  {
    value: 'refresh_token',
    label: 'Refresh Token',
    description: 'Issue refresh tokens to keep sessions active',
  },
]

export function OAuthAppManager() {
  const router = useRouter()
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
  const [editRedirectUrisInput, setEditRedirectUrisInput] = useState('')
  const [savingClient, setSavingClient] = useState(false)

  useEffect(() => {
    loadClients()
  }, [])

  const loadClients = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/v1/oauth/clients')
      if (!response.ok) throw new Error('Failed to load OAuth clients')

      const data = await response.json()
      setClients(data.clients)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clients')
    } finally {
      setLoading(false)
    }
  }

  const createClient = async () => {
    if (!newAppName.trim()) {
      setError('App name is required')
      return
    }

    if (selectedScopes.length === 0) {
      setError('Please select at least one scope')
      return
    }

    if (selectedGrantTypes.length === 0) {
      setError('Select at least one OAuth grant type')
      return
    }

    const redirectUris = redirectUrisInput
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)

    if (selectedGrantTypes.includes('authorization_code') && redirectUris.length === 0) {
      setError('Authorization code grant requires at least one redirect URI')
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
      setError(`Invalid redirect URI: ${invalidRedirect}`)
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
        throw new Error(error.error || 'Failed to create client')
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
      setError(err instanceof Error ? err.message : 'Failed to create client')
    } finally {
      setCreating(false)
    }
  }

  const deleteClient = async (clientId: string) => {
    if (!confirm('Are you sure? This will revoke all tokens for this app.')) return

    try {
      const response = await fetch(`/api/v1/oauth/clients/${clientId}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete client')

      await loadClients()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete client')
    }
  }

  const regenerateSecret = async (clientId: string) => {
    if (!confirm('Regenerate client secret? The old secret will stop working immediately.')) return

    try {
      const response = await fetch(`/api/v1/oauth/clients/${clientId}/regenerate-secret`, {
        method: 'POST',
      })

      if (!response.ok) throw new Error('Failed to regenerate secret')

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
      setError(err instanceof Error ? err.message : 'Failed to regenerate secret')
    }
  }

  const copyToClipboard = async (text: string, field: string) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        setCopiedField(field)
        setTimeout(() => setCopiedField(null), 2000)
        toast.success('Copied to clipboard')
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
        toast.success('Copied to clipboard')
      }
    } catch (err) {
      console.error('Failed to copy:', err)
      toast.error('Failed to copy to clipboard')
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

  const openTestDialog = (client: OAuthClient) => {
    // Navigate directly to testing page with client ID pre-filled
    router.push(`/settings/api-testing?clientId=${encodeURIComponent(client.clientId)}&clientName=${encodeURIComponent(client.name)}`)
  }

  const openEditDialog = (client: OAuthClient) => {
    setEditingClient(client)
    setEditRedirectUrisInput((client.redirectUris || []).join('\n'))
    setEditDialogOpen(true)
  }

  const saveClientUpdates = async () => {
    if (!editingClient) return
    const redirectUris = editRedirectUrisInput
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)

    try {
      setSavingClient(true)
      const response = await fetch(`/api/v1/oauth/clients/${editingClient.clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingClient.name,
          description: editingClient.description,
          redirectUris,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update client')
      }

      toast.success('OAuth client updated')
      setEditDialogOpen(false)
      setEditingClient(null)
      await loadClients()
    } catch (err) {
      console.error('Failed to update OAuth client:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to update OAuth client')
    } finally {
      setSavingClient(false)
    }
  }

  const testOAuthApp = async () => {
    if (!testingClient || !testClientSecret) {
      setError('Client secret is required')
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
        throw new Error(error.error || 'Failed to obtain access token')
      }

      const data = await response.json()
      const accessToken = data.access_token

      // Close dialog
      setTestDialogOpen(false)
      setTestClientSecret('')

      // Navigate to testing page with token
      router.push(`/settings/api-testing?token=${encodeURIComponent(accessToken)}`)

      toast.success('Access token obtained! Redirecting to API testing...')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to obtain token')
      toast.error(err instanceof Error ? err.message : 'Failed to obtain token')
    } finally {
      setObtainingToken(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8">Loading OAuth applications...</div>
  }

  return (
    <div className="space-y-6">
      {/* Error Display */}
      {error && (
        <Card className="border-red-500 bg-red-50 dark:bg-red-950">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-2 text-red-700 dark:text-red-300">
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
              <DialogTitle>OAuth Client Created!</DialogTitle>
              <DialogDescription>
                ⚠️ Save these credentials now - the client secret will not be shown again!
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label>Client ID</Label>
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
                <Label>Client Secret</Label>
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
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                  ⚠️ This secret will only be shown once. Copy it now!
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setNewClientCredentials(null)}>
                  Close
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
                        throw new Error(error.error || 'Failed to obtain access token')
                      }

                      const data = await response.json()
                      const accessToken = data.access_token

                      setNewClientCredentials(null)
                      router.push(`/settings/api-testing?token=${encodeURIComponent(accessToken)}`)
                      toast.success('Access token obtained! Redirecting to API testing...')
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Failed to obtain token')
                    } finally {
                      setObtainingToken(false)
                    }
                  }}
                  disabled={obtainingToken}
                >
                  {obtainingToken ? (
                    'Obtaining Token...'
                  ) : (
                    <>
                      <FlaskConical className="w-4 h-4 mr-2" />
                      Test API Now
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
          <h2 className="text-2xl font-bold theme-text-primary">OAuth Applications</h2>
          <p className="theme-text-muted">Manage API access for your applications</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New App
        </Button>
      </div>

      {/* Client List */}
      {clients.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="theme-text-muted mb-4">No OAuth applications yet</p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First App
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
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openEditDialog(client)}
                    >
                      <Pencil className="w-4 h-4 mr-2" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => regenerateSecret(client.clientId)}
                    >
                      <Key className="w-4 h-4 mr-2" />
                      Regenerate
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
                  <Label className="text-xs">Client ID</Label>
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
                  <Label className="text-xs">Scopes</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {client.scopes.map(scope => (
                      <Badge key={scope} variant="secondary" className="text-xs">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Grant Types</Label>
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
                    <Label className="text-xs">Redirect URIs</Label>
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
                  <span>Created: {new Date(client.createdAt).toLocaleDateString()}</span>
                  {client.lastUsedAt && (
                    <span>Last used: {new Date(client.lastUsedAt).toLocaleDateString()}</span>
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
            <DialogTitle>Test OAuth Application</DialogTitle>
            <DialogDescription>
              Enter your client secret to obtain an access token and test the API
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Application</Label>
              <Input
                value={testingClient?.name || ''}
                readOnly
                className="bg-gray-50"
              />
            </div>

            <div>
              <Label>Client ID</Label>
              <Input
                value={testingClient?.clientId || ''}
                readOnly
                className="font-mono text-sm bg-gray-50"
              />
            </div>

            <div>
              <Label htmlFor="test-secret">Client Secret *</Label>
              <Input
                id="test-secret"
                type="password"
                value={testClientSecret}
                onChange={(e) => setTestClientSecret(e.target.value)}
                placeholder="Enter your client secret"
                className="font-mono text-sm"
              />
              <p className="text-xs theme-text-muted mt-1">
                Your client secret was shown when you created this app
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setTestDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={testOAuthApp} disabled={obtainingToken || !testClientSecret}>
                {obtainingToken ? 'Obtaining Token...' : 'Test API'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create App Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create OAuth Application</DialogTitle>
            <DialogDescription>
              Create a new OAuth client for API access
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="app-name">Application Name *</Label>
              <Input
                id="app-name"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                placeholder="My App"
              />
            </div>

            <div>
              <Label htmlFor="app-description">Description</Label>
              <Input
                id="app-description"
                value={newAppDescription}
                onChange={(e) => setNewAppDescription(e.target.value)}
                placeholder="What this app does"
              />
            </div>

            <div>
              <Label>Scopes *</Label>
              <div className="space-y-2 mt-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectScopeGroup('mobile_app')}
                  >
                    Mobile App (Full Access)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectScopeGroup('readonly')}
                  >
                    Read Only
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectScopeGroup('ai_agent')}
                  >
                    AI Agent
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedScopes([])}
                  >
                    Clear All
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                  {Object.entries(OAUTH_SCOPES).filter(([scope]) => scope !== '*').map(([scope, description]) => (
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
                        <span className="text-xs theme-text-muted block">{description}</span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <Label>Grant Types *</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {GRANT_TYPE_OPTIONS.map(option => (
                  <div key={option.value} className="flex items-start space-x-2">
                    <Checkbox
                      id={`grant-${option.value}`}
                      checked={selectedGrantTypes.includes(option.value)}
                      onCheckedChange={() => toggleGrantType(option.value)}
                    />
                    <label htmlFor={`grant-${option.value}`} className="text-sm cursor-pointer">
                      <div className="font-medium">{option.label}</div>
                      <p className="text-xs theme-text-muted">{option.description}</p>
                    </label>
                  </div>
                ))}
              </div>
              <p className="text-xs theme-text-muted mt-2">
                Enable <code className="px-1 theme-bg-tertiary rounded text-[10px]">authorization_code</code> for ChatGPT or other user-consented integrations. It requires at least one redirect URI.
              </p>
            </div>

            <div>
              <Label htmlFor="redirect-uris">Redirect URIs</Label>
              <Textarea
                id="redirect-uris"
                value={redirectUrisInput}
                onChange={(e) => setRedirectUrisInput(e.target.value)}
                placeholder="https://chat.openai.com/aip/api/v1/oauth/callback"
                className="mt-1 font-mono text-sm"
                rows={3}
              />
              <p className="text-xs theme-text-muted mt-2">
                One URL per line. Required for authorization code flow (ChatGPT, web apps). {BRAND.appName} will only redirect to URLs listed here.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createClient} disabled={creating}>
                {creating ? 'Creating...' : 'Create Application'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Client Dialog */}
      <Dialog
        open={editDialogOpen}
        onOpenChange={(open) => {
          setEditDialogOpen(open)
          if (!open) {
            setEditingClient(null)
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit OAuth Application</DialogTitle>
            <DialogDescription>
              Update redirect URLs or other metadata required by your integrations.
            </DialogDescription>
          </DialogHeader>

          {editingClient ? (
            <div className="space-y-4">
              <div>
                <Label>Application</Label>
                <Input value={editingClient.name} readOnly className="bg-gray-50" />
              </div>
              <div>
                <Label>Description</Label>
                <Input value={editingClient.description || ''} readOnly className="bg-gray-50" />
              </div>
              <div>
                <Label htmlFor="redirect-uris-edit">Redirect URIs</Label>
                <Textarea
                  id="redirect-uris-edit"
                  value={editRedirectUrisInput}
                  onChange={(e) => setEditRedirectUrisInput(e.target.value)}
                  className="font-mono text-sm mt-1"
                  rows={5}
                  placeholder="https://chat.openai.com/aip/.../oauth/callback"
                />
                <p className="text-xs theme-text-muted mt-2">
                  One URL per line. {BRAND.appName} will only redirect users to the exact URLs listed here. Add ChatGPT&apos;s action callback URL (from GPT Builder) to fix <code>invalid_redirect_uri</code> errors.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline" onClick={() => { setEditDialogOpen(false); setEditingClient(null) }}>
                  Cancel
                </Button>
                <Button onClick={saveClientUpdates} disabled={savingClient}>
                  {savingClient ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm theme-text-muted">Select an OAuth app to edit.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
