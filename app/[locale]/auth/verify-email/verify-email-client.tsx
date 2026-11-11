"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingScreen } from "@/components/loading-screen"
import { CheckCircle, XCircle, Mail, AlertCircle } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"

/**
 * Messages this page sets itself, kept as keys and translated when shown.
 * Anything else in "message" came from the server and is shown as it is.
 */
const LOCAL_MESSAGES = new Set([
  'verifyEmailPage.verificationFailed',
  'verifyEmailPage.noToken',
  'verifyEmailPage.resent',
  'verifyEmailPage.resendFailed',
])

function VerifyEmailContent() {
  const { t } = useTranslations()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { data: session } = useSession()
  const token = searchParams?.get('token')

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'expired'>('loading')
  const [message, setMessage] = useState('')
  const [isResending, setIsResending] = useState(false)

  const verifyToken = useCallback(async (token: string) => {
    try {
      const response = await fetch(`/api/v1/users/me/verify-email?token=${token}`, {
        method: 'POST'
      })

      const data = await response.json()

      if (data.success) {
        setStatus('success')
        setMessage(data.message)
        // Redirect to settings after a delay
        setTimeout(() => {
          router.push('/settings?verified=true')
        }, 3000)
      } else {
        setStatus('error')
        setMessage(data.message)
      }
    } catch (error) {
      setStatus('error')
      setMessage('verifyEmailPage.verificationFailed')
    }
  }, [router])

  useEffect(() => {
    if (token) {
      verifyToken(token)
    } else {
      setStatus('error')
      setMessage('verifyEmailPage.noToken')
    }
  }, [token, verifyToken])

  const handleResendVerification = async () => {
    if (!session?.user) {
      router.push('/auth/signin')
      return
    }

    setIsResending(true)
    try {
      const response = await fetch('/api/v1/users/me/verify-email?action=resend', {
        method: 'POST'
      })

      const data = await response.json()

      if (data.success) {
        setMessage('verifyEmailPage.resent')
      } else {
        setMessage(data.message || 'verifyEmailPage.resendFailed')
      }
    } catch (error) {
      setMessage('verifyEmailPage.resendFailed')
    } finally {
      setIsResending(false)
    }
  }

  if (status === 'loading') {
    return <LoadingScreen />
  }

  const getIcon = () => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-12 h-12 text-success mx-auto mb-4" />
      case 'error':
        return <XCircle className="w-12 h-12 text-danger mx-auto mb-4" />
      case 'expired':
        return <AlertCircle className="w-12 h-12 text-warning mx-auto mb-4" />
      default:
        return <Mail className="w-12 h-12 text-brand mx-auto mb-4" />
    }
  }

  const getTitle = () => {
    switch (status) {
      case 'success':
        return t('verifyEmailPage.verifiedTitle')
      case 'error':
        return t('verifyEmailPage.failedTitle')
      case 'expired':
        return t('verifyEmailPage.expiredTitle')
      default:
        return t('verifyEmailPage.defaultTitle')
    }
  }

  return (
    <div className="min-h-screen bg-theme-primary flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-theme-surface border-theme-surface">
        <CardHeader className="text-center">
          {getIcon()}
          <CardTitle className="text-theme-primary">{getTitle()}</CardTitle>
          <CardDescription className="text-theme-muted">
            {LOCAL_MESSAGES.has(message) ? t(message) : message}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {status === 'success' && (
            <div className="text-center">
              <p className="text-theme-muted text-sm mb-4">
                {t('verifyEmailPage.redirecting')}
              </p>
              <Button
                onClick={() => router.push('/settings')}
                className="bg-success hover:bg-success/90 text-success-foreground"
              >
                {t('verifyEmailPage.goToSettings')}
              </Button>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-3">
              {session?.user && (
                <Button
                  onClick={handleResendVerification}
                  disabled={isResending}
                  className="w-full bg-brand hover:bg-brand-hover text-brand-foreground"
                >
                  {isResending ? t('verifyEmailPage.sending') : t('verifyEmailPage.resend')}
                </Button>
              )}

              <Button
                onClick={() => router.push('/')}
                variant="outline"
                className="w-full border-theme-button text-theme-secondary"
              >
                {t('verifyEmailPage.backToApp')}
              </Button>
            </div>
          )}

          {status === 'expired' && (
            <div className="space-y-3">
              <p className="text-theme-muted text-sm text-center">
                {t('verifyEmailPage.expiredBody')}
              </p>

              {session?.user ? (
                <div className="space-y-2">
                  <Button
                    onClick={handleResendVerification}
                    disabled={isResending}
                    className="w-full bg-brand hover:bg-brand-hover text-brand-foreground"
                  >
                    {isResending ? t('verifyEmailPage.sending') : t('verifyEmailPage.sendNew')}
                  </Button>

                  <Button
                    onClick={() => router.push('/settings')}
                    variant="outline"
                    className="w-full border-theme-button text-theme-secondary"
                  >
                    {t('verifyEmailPage.goToSettings')}
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => router.push('/auth/signin')}
                  className="w-full bg-brand hover:bg-brand-hover text-brand-foreground"
                >
                  {t('auth.signInButton')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function VerifyEmailClient() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <VerifyEmailContent />
    </Suspense>
  )
}
