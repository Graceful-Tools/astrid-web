/**
 * GitHub App Setup Component
 * Simplified setup - each user only sees their own installation
 * Also auto-detects unlinked GitHub installations
 */

"use client"

import { BRAND } from '@/lib/brand/config'
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  ExternalLink,
  CheckCircle,
  Github,
  RefreshCw,
  Info,
  X,
  Link as LinkIcon
} from "lucide-react"
import { toast } from "sonner"

interface GitHubInstallation {
  id: number
  account: {
    login: string
    avatar_url: string
  }
}

interface ConnectionStatus {
  isGitHubConnected: boolean
  repositoryCount: number
  githubIntegration?: {
    installationId: number
    repositoryCount: number
  }
}

export function GitHubSharedSetup() {
  const [installations, setInstallations] = useState<GitHubInstallation[]>([])
  const [detectedInstallations, setDetectedInstallations] = useState<GitHubInstallation[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState<number | null>(null)
  const [disconnecting, setDisconnecting] = useState<number | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null)

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = async () => {
    setLoading(true)
    await Promise.all([
      fetchInstallation(),
      checkConnectionStatus()
    ])
    setLoading(false)
  }

  const checkConnectionStatus = async () => {
    try {
      const response = await fetch('/api/github/status')
      if (response.ok) {
        const data = await response.json()
        setConnectionStatus(data)
      }
    } catch (error) {
      console.error('Error checking connection status:', error)
    }
  }

  const fetchInstallation = async () => {
    try {
      const response = await fetch('/api/github/installations')
      if (response.ok) {
        const data = await response.json()
        // API returns all linked installations OR detected unlinked installations
        setInstallations(data.installations || [])
        setDetectedInstallations(data.detectedInstallations || [])
      }
    } catch (error) {
      console.error('Error fetching installation:', error)
    }
  }

  const handleInstallApp = () => {
    // Open GitHub App installation page
    // After installation, GitHub redirects to /api/github/setup with the installation_id
    window.location.href = `https://github.com/apps/${BRAND.githubAppSlug}/installations/new`
  }

  const handleConnectInstallation = async (installationId: number) => {
    try {
      setConnecting(installationId)

      const response = await fetch('/api/github/connect-installation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId })
      })

      if (response.ok) {
        const data = await response.json()
        toast.success(data.message || 'GitHub connected successfully')
        await loadData()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Failed to connect installation')
      }
    } catch (error) {
      toast.error('Failed to connect GitHub installation')
    } finally {
      setConnecting(null)
    }
  }

  const handleDisconnect = async (installationId?: number) => {
    try {
      setDisconnecting(installationId || -1)

      const response = await fetch('/api/github/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId })
      })

      if (response.ok) {
        toast.success('GitHub disconnected successfully')
        if (installationId) {
          // Remove just this installation from state
          setInstallations(prev => prev.filter(i => i.id !== installationId))
        } else {
          // Clear all
          setInstallations([])
        }
        setConnectionStatus(null)
        await loadData()
      } else {
        const error = await response.json()
        toast.error(error.message || 'Failed to disconnect')
      }
    } catch (error) {
      toast.error('Failed to disconnect GitHub')
    } finally {
      setDisconnecting(null)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-gray-600">Checking GitHub connection...</p>
      </div>
    )
  }

  // User has connected installation(s)
  if (connectionStatus?.isGitHubConnected && installations.length > 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <CheckCircle className="w-6 h-6 text-green-500" />
              <div>
                <CardTitle className="text-lg">GitHub Connected</CardTitle>
                <CardDescription>
                  {installations.length === 1
                    ? `Your GitHub account is linked to ${BRAND.appName}`
                    : `${installations.length} GitHub accounts are linked to ${BRAND.appName}`}
                </CardDescription>
              </div>
            </div>
            <Badge variant="default" className="bg-green-600">Connected</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {installations.map((inst) => (
            <div key={inst.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="relative w-10 h-10">
                  <img
                    src={inst.account.avatar_url}
                    alt={inst.account.login}
                    className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                      const fallback = e.currentTarget.nextElementSibling as HTMLElement
                      if (fallback) fallback.classList.remove('hidden')
                    }}
                  />
                  <div className="hidden w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center absolute inset-0">
                    <Github className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </div>
                </div>
                <div>
                  <h4 className="font-medium">{inst.account.login}</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Installation ID: {inst.id}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDisconnect(inst.id)}
                disabled={disconnecting === inst.id}
                className="w-full sm:w-auto"
              >
                {disconnecting === inst.id ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full mr-2"></div>
                    Disconnecting...
                  </>
                ) : (
                  <>
                    <X className="w-4 h-4 mr-2" />
                    Disconnect
                  </>
                )}
              </Button>
            </div>
          ))}

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              className="w-full sm:w-auto"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleInstallApp}
              className="w-full sm:w-auto"
            >
              <Github className="w-4 h-4 mr-2" />
              Add Another Account
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Detected unlinked installations - user installed on GitHub but didn't link to Astrid
  if (detectedInstallations.length > 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Github className="w-6 h-6 text-blue-500" />
            <div>
              <CardTitle>GitHub Installation Detected</CardTitle>
              <CardDescription>
                We found your GitHub App installation. Click to connect it to {BRAND.appName}.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              You&apos;ve already installed the {BRAND.appName} Agent on GitHub. Just click &quot;Connect&quot; below to link it to your {BRAND.appName} account.
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            {detectedInstallations.map((inst) => (
              <div
                key={inst.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-800"
              >
                <div className="flex items-center space-x-3">
                  <div className="relative w-10 h-10">
                    <img
                      src={inst.account.avatar_url}
                      alt={inst.account.login}
                      className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                        const fallback = e.currentTarget.nextElementSibling as HTMLElement
                        if (fallback) fallback.classList.remove('hidden')
                      }}
                    />
                    <div className="hidden w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center absolute inset-0">
                      <Github className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium">{inst.account.login}</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Installation ID: {inst.id}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => handleConnectInstallation(inst.id)}
                  disabled={connecting === inst.id}
                  className="w-full sm:w-auto"
                >
                  {connecting === inst.id ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                      Connecting...
                    </>
                  ) : (
                    <>
                      <LinkIcon className="w-4 h-4 mr-2" />
                      Connect
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>

          <div className="text-center pt-2">
            <Button variant="ghost" size="sm" onClick={loadData}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // User needs to install the GitHub App
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <Github className="w-6 h-6" />
          <div>
            <CardTitle>Connect GitHub</CardTitle>
            <CardDescription>
              Install the {BRAND.appName} Agent to enable AI coding features
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            This will open GitHub where you can install the {BRAND.appName} Agent
            and select which repositories to give access to.
          </AlertDescription>
        </Alert>

        <Button onClick={handleInstallApp} className="w-full" size="lg">
          <ExternalLink className="w-5 h-5 mr-2" />
          Install {BRAND.appName} Agent on GitHub
        </Button>

        <p className="text-sm text-gray-600 text-center">
          After installation, you&apos;ll be redirected back here automatically.
        </p>
      </CardContent>
    </Card>
  )
}