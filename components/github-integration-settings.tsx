"use client"

/**
 * Phase 3: GitHub Integration Settings Component
 * Allows users to connect their GitHub account and manage repositories
 */

import { BRAND } from '@/lib/brand/config'
import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Github,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'

interface Repository {
  id: number
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
  url?: string
}

interface GitHubIntegration {
  id: string
  installationId: number | null
  repositories: Repository[]
  connectedAt: string
}

export function GitHubIntegrationSettings() {
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [integration, setIntegration] = useState<GitHubIntegration | null>(null)

  // Load integration status
  const loadIntegration = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/github/integration')

      if (response.ok) {
        const data = await response.json()
        setIntegration(data.integration)
      } else if (response.status !== 404) {
        throw new Error('Failed to load GitHub integration')
      }
    } catch (error) {
      console.error('Error loading GitHub integration:', error)
      toast.error('Failed to load GitHub integration status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadIntegration()
  }, [])

  // Start GitHub App installation flow
  const handleConnect = async () => {
    try {
      setConnecting(true)

      // Check if we're in development mode
      const isDev = process.env.NODE_ENV === 'development'

      if (isDev) {
        // For local development, use manual setup
        const response = await fetch('/api/github/manual-setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            installationId: 12345678, // Fake installation ID for testing
            repositories: [
              {
                id: 123456789,
                name: 'test-repo',
                fullName: 'test-user/test-repo',
                defaultBranch: 'main',
                private: false
              }
            ]
          })
        })

        if (!response.ok) {
          throw new Error('Failed to setup test integration')
        }

        toast.success('GitHub integration connected (development mode)')
        await loadIntegration()
      } else {
        // Production: Get the GitHub App installation URL
        const response = await fetch('/api/github/install-url')
        if (!response.ok) {
          throw new Error('Failed to get installation URL')
        }

        const { installUrl } = await response.json()

        // Redirect to GitHub App installation
        window.location.href = installUrl
      }

    } catch (error) {
      console.error('Error starting GitHub connection:', error)
      toast.error('Failed to connect to GitHub')
    } finally {
      setConnecting(false)
    }
  }

  // Refresh repositories from GitHub
  const handleRefreshRepositories = async () => {
    if (!integration) return

    try {
      setRefreshing(true)

      const response = await fetch('/api/github/repositories/refresh', {
        method: 'POST'
      })

      if (!response.ok) {
        throw new Error('Failed to refresh repositories')
      }

      await loadIntegration()
      toast.success('Repositories refreshed successfully')

    } catch (error) {
      console.error('Error refreshing repositories:', error)
      toast.error('Failed to refresh repositories')
    } finally {
      setRefreshing(false)
    }
  }

  // Disconnect GitHub integration
  const handleDisconnect = async () => {
    if (!integration) return

    try {
      const response = await fetch('/api/github/integration', {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error('Failed to disconnect GitHub')
      }

      setIntegration(null)
      toast.success('GitHub integration disconnected')

    } catch (error) {
      console.error('Error disconnecting GitHub:', error)
      toast.error('Failed to disconnect GitHub')
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p>Loading GitHub integration...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          GitHub Integration
        </CardTitle>
        <CardDescription>
          Connect your GitHub repositories to enable the {BRAND.appName} Agent to create branches,
          commit changes, and manage pull requests.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!integration ? (
          // Not connected state
          <div className="space-y-4">
            <Alert>
              <Github className="h-4 w-4" />
              <AlertDescription>
                To use the {BRAND.appName} Agent, you need to install our GitHub App and
                connect your repositories.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <h4 className="font-medium">What the GitHub App can do:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Create feature branches for your tasks</li>
                <li>• Commit code changes and implementations</li>
                <li>• Create and manage pull requests</li>
                <li>• Add comments with implementation details</li>
                <li>• Set commit statuses for CI/CD integration</li>
              </ul>
            </div>

            <Button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full"
            >
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Connecting...
                </>
              ) : (
                <>
                  <Github className="h-4 w-4 mr-2" />
                  Connect GitHub Account
                </>
              )}
            </Button>
          </div>
        ) : (
          // Connected state
          <div className="space-y-6">
            {/* Connection Status */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 border rounded-lg bg-green-50">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium text-green-800">GitHub Connected</p>
                  <p className="text-sm text-green-600">
                    Connected on {new Date(integration.connectedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                className="text-red-600 hover:text-red-700 w-full sm:w-auto"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Disconnect
              </Button>
            </div>

            {/* Repository Selection */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-medium">Available Repositories</h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshRepositories}
                  disabled={refreshing}
                  className="w-full sm:w-auto"
                >
                  {refreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Refresh
                </Button>
              </div>

              <div className="space-y-3 max-h-64 overflow-y-auto">
                {integration.repositories.map((repo) => (
                  <div
                    key={repo.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium truncate">{repo.fullName}</span>
                          {repo.private && (
                            <Badge variant="secondary" className="text-xs">Private</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Default branch: {repo.defaultBranch}
                        </p>
                      </div>
                    </div>
                    {repo.url && (
                      <Button variant="ghost" size="sm" asChild>
                        <a href={repo.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              {integration.repositories.length === 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    No repositories found. Make sure the GitHub App is installed on your repositories.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Integration Info */}
            <Alert>
              <Github className="h-4 w-4" />
              <AlertDescription>
                <strong>Ready for coding tasks!</strong> You can now assign tasks to the
                {BRAND.appName} Agent, and it will automatically create branches and pull requests.
                Configure the repository for each list in the list settings.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
    </Card>
  )
}