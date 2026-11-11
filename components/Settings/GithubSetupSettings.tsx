"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { LoadingScreen } from "@/components/loading-screen"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle, AlertCircle, ArrowRight } from "lucide-react"
import { Github } from "@/components/ui/brand-icons"
import { useTranslations } from "@/lib/i18n/client"
import { fillMessage } from "@/components/shared/RichMessage"

interface GithubSetupSettingsProps {
  onNavigate: (page: string) => void
}

export default function GithubSetupSettings({ onNavigate }: GithubSetupSettingsProps) {
  const { t } = useTranslations()
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
          onNavigate('agents')
        }
      }

      handleGitHubCallback()
    }
  }, [status, installationId, code, setupAction, onNavigate])

  const handleContinue = () => {
    onNavigate('agents')
  }

  if (status === "loading") {
    return <LoadingScreen message={t("settingsPages.githubSetup.loading")} />
  }

  if (!session?.user) {
    return <LoadingScreen message={t("settingsPages.githubSetup.authenticating")} />
  }

  // Show error state
  if (error) {
    return (
      <div className="p-4">
        <div className="max-w-md mx-auto mt-16">
          <Card className="theme-bg-secondary border-danger/30">
            <CardHeader>
              <div className="flex items-center space-x-3">
                <AlertCircle className="w-8 h-8 text-danger" />
                <div>
                  <CardTitle className="theme-text-primary">{t("settingsPages.githubSetup.failedTitle")}</CardTitle>
                  <CardDescription className="theme-text-muted">
                    {t("settingsPages.githubSetup.failedDescription")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm theme-text-muted mb-4">
                {fillMessage(t("settingsPages.githubSetup.errorDetail"), { error })}
              </p>
              <Button onClick={handleContinue} className="w-full">
                <ArrowRight className="w-4 h-4 mr-2" />
                {t("settingsPages.githubSetup.returnToSettings")}
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
                <Github className="w-8 h-8 text-theme-secondary" />
                <div>
                  <CardTitle className="theme-text-primary">{t("settingsPages.githubSetup.processingTitle")}</CardTitle>
                  <CardDescription className="theme-text-muted">
                    {t("settingsPages.githubSetup.processingDescription")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-8 h-8 border-4 border-theme-focus border-t-transparent rounded-full"></div>
              </div>
              <p className="text-sm theme-text-muted text-center">
                {t("settingsPages.githubSetup.pleaseWait")}
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
        <Card className="theme-bg-secondary border-success/30">
          <CardHeader>
            <div className="flex items-center space-x-3">
              <CheckCircle className="w-8 h-8 text-success" />
              <div>
                <CardTitle className="theme-text-primary">{t("settingsPages.githubSetup.connectedTitle")}</CardTitle>
                <CardDescription className="theme-text-muted">
                  {t("settingsPages.githubSetup.connectedDescription")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm theme-text-muted mb-4">
              {t("settingsPages.githubSetup.connectedBody")}
            </p>
            <Button onClick={handleContinue} className="w-full">
              <ArrowRight className="w-4 h-4 mr-2" />
              {t("settingsPages.githubSetup.continueToSettings")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
