"use client"

import { BRAND } from '@/lib/brand/config'
import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { LoadingScreen } from "@/components/loading-screen"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle, AlertCircle, Github, ArrowRight } from "lucide-react"

interface GithubSetupSettingsProps {
  onNavigate: (page: string) => void
}

export default function GithubSetupSettings({ onNavigate }: GithubSetupSettingsProps) {
  const searchParams = useSearchParams()
  const { data: session, status } = useSession()

  const installationId = searchParams?.get('installation_id')
  const setupAction = searchParams?.get('setup_action')
  const code = searchParams?.get('code')
  const error = searchParams?.get('error')

  useEffect(() => {
    if (status === "authenticated" && (installationId || code)) {
      const handleGitHubCallback = async () => {
        try {
          const params = new URLSearchParams()
          if (installationId) params.set('installation_id', installationId)
          if (setupAction) params.set('setup_action', setupAction)
          if (code) params.set('code', code)

          // Redirect to the API handler which will process the installation
          window.location.href = `/api/github/setup?${params.toString()}`
        } catch (error) {
          console.error('Error processing GitHub callback:', error)
          onNavigate('coding-agents')
        }
      }

      handleGitHubCallback()
    }
  }, [status, installationId, code, setupAction, onNavigate])

  const handleContinue = () => {
    onNavigate('coding-agents')
  }

  if (status === "loading") {
    return <LoadingScreen message="Loading GitHub setup..." />
  }

  if (!session?.user) {
    return <LoadingScreen message="Authenticating..." />
  }

  // Show error state
  if (error) {
    return (
      <div className="p-4">
        <div className="max-w-md mx-auto mt-16">
          <Card className="theme-bg-secondary theme-border border-red-200">
            <CardHeader>
              <div className="flex items-center space-x-3">
                <AlertCircle className="w-8 h-8 text-red-500" />
                <div>
                  <CardTitle className="theme-text-primary">Setup Failed</CardTitle>
                  <CardDescription className="theme-text-muted">
                    There was an error setting up GitHub integration
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm theme-text-muted mb-4">
                Error: {error}
              </p>
              <Button onClick={handleContinue} className="w-full">
                <ArrowRight className="w-4 h-4 mr-2" />
                Return to Settings
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Show processing state while handling callback
  if (installationId || code) {
    return (
      <div className="p-4">
        <div className="max-w-md mx-auto mt-16">
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Github className="w-8 h-8 text-gray-700" />
                <div>
                  <CardTitle className="theme-text-primary">Processing GitHub Setup</CardTitle>
                  <CardDescription className="theme-text-muted">
                    Connecting your GitHub installation...
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
              </div>
              <p className="text-sm theme-text-muted text-center">
                Please wait while we configure your GitHub integration...
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Default success state
  return (
    <div className="p-4">
      <div className="max-w-md mx-auto mt-16">
        <Card className="theme-bg-secondary theme-border border-green-200">
          <CardHeader>
            <div className="flex items-center space-x-3">
              <CheckCircle className="w-8 h-8 text-green-500" />
              <div>
                <CardTitle className="theme-text-primary">GitHub Connected!</CardTitle>
                <CardDescription className="theme-text-muted">
                  Your GitHub integration is ready to use
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm theme-text-muted mb-4">
              You can now use the {BRAND.appName} Agent to generate code and create pull requests.
            </p>
            <Button onClick={handleContinue} className="w-full">
              <ArrowRight className="w-4 h-4 mr-2" />
              Continue to Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
