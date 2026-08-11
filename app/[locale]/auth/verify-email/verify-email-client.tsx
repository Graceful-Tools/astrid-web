"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingScreen } from "@/components/loading-screen"
import { CheckCircle, XCircle, Mail, AlertCircle } from "lucide-react"

function VerifyEmailContent() {
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
      setMessage('Verification failed. Please try again.')
    }
  }, [router])

  useEffect(() => {
    if (token) {
      verifyToken(token)
    } else {
      setStatus('error')
      setMessage('No verification token provided')
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
        setMessage('Verification email resent. Please check your inbox.')
      } else {
        setMessage(data.message || 'Failed to resend verification email')
      }
    } catch (error) {
      setMessage('Failed to resend verification email')
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
        return <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
      case 'error':
        return <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
      case 'expired':
        return <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
      default:
        return <Mail className="w-12 h-12 text-blue-500 mx-auto mb-4" />
    }
  }

  const getTitle = () => {
    switch (status) {
      case 'success':
        return 'Email Verified!'
      case 'error':
        return 'Verification Failed'
      case 'expired':
        return 'Link Expired'
      default:
        return 'Email Verification'
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-gray-800 border-gray-700">
        <CardHeader className="text-center">
          {getIcon()}
          <CardTitle className="text-white">{getTitle()}</CardTitle>
          <CardDescription className="text-gray-400">
            {message}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {status === 'success' && (
            <div className="text-center">
              <p className="text-gray-400 text-sm mb-4">
                Redirecting to settings in a few seconds...
              </p>
              <Button
                onClick={() => router.push('/settings')}
                className="bg-green-600 hover:bg-green-700"
              >
                Go to Settings
              </Button>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-3">
              {session?.user && (
                <Button
                  onClick={handleResendVerification}
                  disabled={isResending}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {isResending ? "Sending..." : "Resend Verification Email"}
                </Button>
              )}

              <Button
                onClick={() => router.push('/')}
                variant="outline"
                className="w-full border-gray-600 text-gray-300"
              >
                Back to App
              </Button>
            </div>
          )}

          {status === 'expired' && (
            <div className="space-y-3">
              <p className="text-gray-400 text-sm text-center">
                The verification link has expired. You can request a new one from your account settings.
              </p>

              {session?.user ? (
                <div className="space-y-2">
                  <Button
                    onClick={handleResendVerification}
                    disabled={isResending}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                  >
                    {isResending ? "Sending..." : "Send New Verification Email"}
                  </Button>

                  <Button
                    onClick={() => router.push('/settings')}
                    variant="outline"
                    className="w-full border-gray-600 text-gray-300"
                  >
                    Go to Settings
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => router.push('/auth/signin')}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  Sign In
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
