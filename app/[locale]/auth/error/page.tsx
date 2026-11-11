"use client"

import { BRAND } from '@/lib/brand/config'
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Heart, AlertCircle, ArrowLeft } from "lucide-react"
import { Suspense } from "react"
import { scrollShellClassName } from "@/components/scroll-shell"
import { useTranslations } from "@/lib/i18n/client"

function AuthErrorContent() {
  const { t } = useTranslations()
  const searchParams = useSearchParams()
  const error = searchParams?.get("error") ?? null

  const getErrorMessage = (error: string | null) => {
    switch (error) {
      case "Configuration":
        return t('authErrors.configuration')
      case "AccessDenied":
        return t('authErrors.accessDenied')
      case "Verification":
        return t('authErrors.verification')
      default:
        return t('authErrors.unexpected')
    }
  }

  return (
    <div className={`${scrollShellClassName} bg-theme-primary flex items-center justify-center p-4`}>
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <Heart className="w-8 h-8 text-red-500 fill-red-500" />
            <span className="text-3xl font-bold text-theme-primary">{BRAND.wordmark}</span>
          </div>
        </div>

        {/* Error Card */}
        <Card className="bg-theme-surface border-theme-surface">
          <CardHeader className="text-center">
            <CardTitle className="text-theme-primary">{t('authErrorPage.title')}</CardTitle>
            <CardDescription className="text-theme-muted">{t('authErrorPage.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-danger-subtle border-danger/20">
              <AlertCircle className="h-4 w-4 text-danger" />
              <AlertDescription className="text-theme-primary">{getErrorMessage(error)}</AlertDescription>
            </Alert>

            <div className="flex flex-col space-y-2">
              <Button asChild className="w-full">
                <Link href="/auth/signin">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  {t('authErrorPage.tryAgain')}
                </Link>
              </Button>
              <Button variant="outline" asChild className="w-full bg-transparent">
                <Link href="/">{t('authErrorPage.goHome')}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function AuthError() {
  const { t } = useTranslations()
  return (
    <Suspense fallback={<div className={`${scrollShellClassName} bg-theme-primary flex items-center justify-center p-4`}><div className="text-theme-primary">{t('authErrorPage.loading')}</div></div>}>
      <AuthErrorContent />
    </Suspense>
  )
}
