"use client"

import { AUTH_PROVIDERS, CAPABILITIES } from '@/lib/brand/capabilities'
import { BRAND } from '@/lib/brand/config'
import { signIn, getProviders } from "next-auth/react"
import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, AlertCircle, Mail, KeyRound, Building2 } from "lucide-react"
import { Chrome, Github } from "@/components/ui/brand-icons"
import Image from "next/image"
import { useWebAuthn } from "@/hooks/use-webauthn"
import Link from "next/link"
import { createLogger } from '@/lib/logger'
import { planGoogleSignIn } from "@/lib/auth-host"
import { scrollShellClassName } from "@/components/scroll-shell"
import { useTranslations } from "@/lib/i18n/client"

const log = createLogger('[locale].auth.signin.signin-client.tsx')

// Shared by the App Store badge and the Apple sign-in button.
function AppleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  )
}

export function SignInContent() {
  const { t } = useTranslations()
  const [providers, setProviders] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Passkey signup email prompt state
  const [showPasskeyEmailPrompt, setShowPasskeyEmailPrompt] = useState(false)
  const [passkeyEmail, setPasskeyEmail] = useState("")

  const searchParams = useSearchParams()
  const router = useRouter()
  const urlError = searchParams?.get("error") ?? null

  // Passkey support
  const {
    isSupported: isPasskeySupported,
    isLoading: isPasskeyLoading,
    error: passkeyError,
    registerPasskey,
    authenticateWithPasskey,
    clearError: clearPasskeyError,
  } = useWebAuthn()

  // Fetch providers in background — render buttons immediately to avoid blocking LCP
  useEffect(() => {
    getProviders()
      .then((res) => {
        setProviders(res)
      })
      .catch((err) => {
        log.error({ err: err }, "Failed to fetch providers:")
      })
  }, [])

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError(null)

    // Google OAuth's redirect_uri is only whitelisted for astrid.cc.
    // On a preview subdomain, bounce to the canonical sign-in page
    // (carrying this origin as callbackUrl) instead of starting OAuth
    // here — otherwise Google returns redirect_uri_mismatch.
    const plan = planGoogleSignIn(window.location.origin)
    if (plan.mode === "redirect") {
      window.location.href = plan.url
      return
    }

    try {
      // Honor a callbackUrl passed in by a preview bounce so the user
      // returns to the preview after authenticating on astrid.cc.
      const callbackUrl = searchParams?.get("callbackUrl") || "/"
      const result = await signIn("google", {
        callbackUrl,
        redirect: false,
      })

      if (result?.error) {
        setError(result.error)
      } else if (result?.url) {
        window.location.href = result.url
      }
    } catch (error) {
      log.error({ err: error }, "Google sign in error:")
      setError("SignInUnexpected")
    } finally {
      setLoading(false)
    }
  }

  // GitHub, SSO and Apple are plain redirects to the provider (spec §6.2): no
  // preview bounce, since each brand registers its own callback URLs.
  const handleRedirectSignIn = async (providerId: "github" | "sso" | "apple") => {
    setLoading(true)
    setError(null)
    try {
      await signIn(providerId, { callbackUrl: searchParams?.get("callbackUrl") || "/" })
    } catch (error) {
      log.error({ err: error, providerId }, "Sign in error:")
      setError("SignInUnexpected")
      setLoading(false)
    }
  }

  const handlePasskeySignIn = async () => {
    clearPasskeyError()
    setError(null)
    await authenticateWithPasskey()
  }

  // Unified passkey flow (matching iOS): Try auth first, then offer email signup if cancelled
  const handleUnifiedPasskeyFlow = async () => {
    clearPasskeyError()
    setError(null)

    // Try to authenticate with existing passkey first
    // Browser will show any available passkeys for this domain
    const result = await authenticateWithPasskey()

    // If user cancelled or authentication failed, show email prompt to create new account
    if (!result.success) {
      // Clear any error message (user cancelled is not an error to display)
      clearPasskeyError()
      setError(null)
      // Show email prompt to create new account with passkey
      setShowPasskeyEmailPrompt(true)
    }
    // If success, authenticateWithPasskey already redirects to home
  }

  const handlePasskeySignUp = async () => {
    // If no email yet, show the email prompt
    if (!passkeyEmail) {
      setShowPasskeyEmailPrompt(true)
      return
    }
    clearPasskeyError()
    setError(null)
    await registerPasskey(passkeyEmail, "My Passkey")
  }

  const handlePasskeyEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passkeyEmail) {
      setError("EmailRequired")
      return
    }
    clearPasskeyError()
    setError(null)
    await registerPasskey(passkeyEmail, "My Passkey")
  }

  const getErrorMessage = (error: string) => {
    // NextAuth error codes are short single-word strings
    // Passkey errors are full sentences - show them directly
    if (error.includes(" ") || error.length > 30) {
      return error
    }

    switch (error) {
      // Set by this page. A code rather than the sentence, so the rule above
      // (a sentence is shown as it is) does not depend on the language.
      case "SignInUnexpected":
        return t('authErrors.signInUnexpected')
      case "EmailRequired":
        return t('authErrors.emailRequired')
      case "Configuration":
        return t('authErrors.configurationDetailed')
      case "AccessDenied":
        return t('authErrors.accessDenied')
      case "Verification":
        return t('authErrors.verification')
      case "OAuthSignin":
        return t('authErrors.oauthSignin')
      case "OAuthCallback":
        return t('authErrors.oauthCallback')
      case "OAuthCreateAccount":
        return t('authErrors.oauthCreateAccount')
      case "EmailCreateAccount":
        return t('authErrors.emailCreateAccount')
      case "Callback":
        return t('authErrors.callback')
      case "OAuthAccountNotLinked":
        return t('authErrors.oauthAccountNotLinked')
      case "EmailSignin":
        return t('authErrors.emailSignin')
      case "SessionRequired":
        return t('authErrors.sessionRequired')
      default:
        return t('authErrors.default')
    }
  }

  const displayError = error || urlError || passkeyError

  return (
    <div className={`${scrollShellClassName} theme-bg-primary`}>
      <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header - Logo and Tagline (matching iOS) */}
        <div className="flex items-center justify-center gap-4 mb-4">
          <Image
            src={BRAND.logo}
            alt={BRAND.appName}
            width={88}
            height={88}
            priority
            className="rounded-2xl"
          />
          <div className="text-left">
            <h1 className="text-4xl font-bold theme-text-primary">{BRAND.wordmark}</h1>
            <p className="theme-text-secondary text-lg">{BRAND.slogan}</p>
          </div>
        </div>

        {/* App Store Download Button — hidden when the brand has no published app,
            so a partner deployment does not advertise someone else's listing. */}
        {BRAND.appStoreUrl && (
        <div className="flex justify-center mb-8">
          <a
            href={BRAND.appStoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 theme-surface hover:bg-[rgb(var(--theme-surface-hover))] border theme-border-input rounded-xl theme-text-primary text-sm font-medium transition-colors"
          >
            <AppleLogo className="w-5 h-5" />
            {t('signInPage.downloadOnAppStore')}
          </a>
        </div>
        )}

        {/* Authentication Card */}
        <Card className="theme-surface theme-border theme-shadow-lg">
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-2xl font-semibold theme-text-primary">
              {t('signInPage.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-8 pb-8">
            {displayError && (
              <Alert className="mb-6 border-danger/40 bg-danger-subtle">
                <AlertCircle className="h-4 w-4 text-danger" />
                <AlertDescription className="theme-text-primary">{getErrorMessage(displayError)}</AlertDescription>
              </Alert>
            )}

            {/* Create Account View (Default) */}
            {!showPasskeyEmailPrompt && (
              <div className="space-y-4">
                {/* Opt-in providers, in the brand's configured order (spec §6.2).
                    The server omits their NextAuth providers when unlisted, so
                    this is presentation, not the boundary. */}
                {AUTH_PROVIDERS.filter((id): id is "github" | "sso" => id === "github" || id === "sso").map(id => (
                <Button
                  key={id}
                  type="button"
                  onClick={() => handleRedirectSignIn(id)}
                  disabled={loading || isPasskeyLoading}
                  className="w-full theme-surface hover:bg-[rgb(var(--theme-surface-hover))] theme-text-primary border theme-border-input font-medium h-12 rounded-xl shadow-sm"
                  size="lg"
                >
                  {id === "github" ? <Github className="w-5 h-5 mr-2" /> : <Building2 className="w-5 h-5 mr-2" />}
                  {t('auth.continueWith', { provider: id === "github" ? "GitHub" : providers?.sso?.name ?? "SSO" })}
                </Button>
                ))}

                {/* 1. Google - Most prominent (blue), rendered immediately for fast LCP */}
                {/* Hidden when the deployment disables Google sign-in; the NextAuth
                    provider is omitted too, so this is presentation, not the boundary. */}
                {CAPABILITIES.authGoogle && (
                <Button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading || isPasskeyLoading}
                  className="w-full bg-[rgb(var(--theme-accent))] hover:bg-[rgb(var(--theme-accent-hover))] text-[rgb(var(--theme-accent-text))] font-medium h-12 rounded-xl shadow-sm"
                  size="lg"
                >
                  {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Chrome className="w-5 h-5 mr-2" />}
                  {loading ? t('signInPage.continuing') : t('auth.continueWith', { provider: "Google" })}
                </Button>
                )}

                {/* Apple — only once the server has registered its web provider, which
                    takes credentials native Apple sign-in does not (AWTD-1110), so the
                    switch alone is not enough to show it. */}
                {CAPABILITIES.authApple && providers?.apple && (
                <Button
                  type="button"
                  onClick={() => handleRedirectSignIn("apple")}
                  disabled={loading || isPasskeyLoading}
                  className="w-full theme-surface hover:bg-[rgb(var(--theme-surface-hover))] theme-text-primary border theme-border-input font-medium h-12 rounded-xl shadow-sm"
                  size="lg"
                >
                  <AppleLogo className="w-5 h-5 mr-2" />
                  {t('auth.continueWith', { provider: "Apple" })}
                </Button>
                )}

                {/* 2. Passkey - Opens dialog with New/Returning options */}
                {CAPABILITIES.authPasskey && (
                <>
                <Button
                  type="button"
                  onClick={() => {
                    setPasskeyEmail("")
                    setShowPasskeyEmailPrompt(true)
                  }}
                  disabled={loading || isPasskeyLoading || !isPasskeySupported}
                  className={`w-full font-medium h-12 rounded-xl shadow-sm ${
                    isPasskeySupported
                      ? "theme-surface hover:bg-[rgb(var(--theme-surface-hover))] theme-text-primary border theme-border-input"
                      : "theme-bg-tertiary theme-text-muted cursor-not-allowed"
                  }`}
                  size="lg"
                >
                  <KeyRound className="w-5 h-5 mr-2" />
                  {t('auth.continueWith', { provider: t('signInPage.passkey') })}
                </Button>
                {!isPasskeySupported && (
                  <p className="text-xs theme-text-muted text-center -mt-2">
                    {t('signInPage.passkeysNotSupported')}
                  </p>
                )}
                </>
                )}
              </div>
            )}

            {/* Passkey Dialog - New/Returning options */}
            {showPasskeyEmailPrompt && (
              <div className="space-y-5">
                <div className="text-center mb-2">
                  <KeyRound className="w-10 h-10 text-brand mx-auto mb-2" />
                  <p className="theme-text-primary font-medium">{t('auth.continueWith', { provider: t('signInPage.passkey') })}</p>
                </div>

                {/* New user - Email input */}
                <div>
                  <Label htmlFor="passkey-email" className="text-sm font-medium theme-text-secondary mb-2 block">
                    {t('signInPage.newUser')}
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 theme-text-muted" />
                    <Input
                      id="passkey-email"
                      type="email"
                      value={passkeyEmail}
                      onChange={(e) => setPasskeyEmail(e.target.value)}
                      placeholder={t('signInPage.emailPlaceholder')}
                      className="pl-10 h-12 theme-input theme-text-primary focus:border-theme-focus focus:ring-brand rounded-xl"
                      autoFocus
                    />
                  </div>
                </div>

                {/* Returning user - Only show when no email entered */}
                {!passkeyEmail && (
                  <div className="text-center">
                    <p className="text-sm font-medium theme-text-secondary mb-2">{t('signInPage.returningUser')}</p>
                  </div>
                )}

                {/* Single button that handles both cases */}
                <Button
                  type="button"
                  onClick={async () => {
                    clearPasskeyError()
                    setError(null)
                    if (passkeyEmail) {
                      // New user with email - register passkey
                      await registerPasskey(passkeyEmail, "My Passkey")
                    } else {
                      // Returning user - authenticate with existing passkey
                      await authenticateWithPasskey()
                    }
                  }}
                  disabled={loading || isPasskeyLoading}
                  className="w-full theme-surface hover:bg-[rgb(var(--theme-surface-hover))] theme-text-primary font-medium h-12 rounded-xl shadow-sm border theme-border-input"
                  size="lg"
                >
                  {isPasskeyLoading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <KeyRound className="w-5 h-5 mr-2" />}
                  {isPasskeyLoading
                    ? (passkeyEmail ? t('signInPage.creatingAccount') : t('signInPage.signingIn'))
                    : t('auth.continueWith', { provider: t('signInPage.passkey') })
                  }
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setShowPasskeyEmailPrompt(false)
                    setPasskeyEmail("")
                    setError(null)
                  }}
                  className="w-full theme-text-secondary hover:text-[rgb(var(--theme-text-primary))] text-sm"
                >
                  {t('signInPage.backToOptions')}
                </button>
              </div>
            )}



            <div className="text-center text-sm theme-text-muted mt-6">
              <p>
                {/* One sentence with two links: the message keeps its {terms} and
                    {privacy} slots so each language orders them its own way. */}
                {t('signInPage.agreement').split(/(\{terms\}|\{privacy\})/).map((part, index) =>
                  part === '{terms}' ? (
                    <Link key={index} href="/terms" className="text-brand hover:text-brand-hover underline">
                      {t('signInPage.termsOfService')}
                    </Link>
                  ) : part === '{privacy}' ? (
                    <Link key={index} href="/privacy" className="text-brand hover:text-brand-hover underline">
                      {t('signInPage.privacyPolicy')}
                    </Link>
                  ) : (
                    part
                  )
                )}
              </p>
              <p className="mt-2">
                {t('signInPage.havingTrouble')}{" "}
                <Link href="/help" className="text-brand hover:text-brand-hover underline">
                  {t('signInPage.visitHelpCenter')}
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Features Preview */}
        <div className="mt-8 grid grid-cols-1 gap-4 text-center">
          <div className="theme-surface rounded-2xl p-6 border theme-border theme-shadow-sm">
            <h3 className="theme-text-primary font-semibold mb-2">{t('signInPage.organizeTitle')}</h3>
            <p className="theme-text-secondary text-sm">
              {t('signInPage.organizeDesc')}
            </p>
          </div>
          <div className="theme-surface rounded-2xl p-6 border theme-border theme-shadow-sm">
            <h3 className="theme-text-primary font-semibold mb-2">{t('signInPage.collaborateTitle')}</h3>
            <p className="theme-text-secondary text-sm">
              {t('signInPage.collaborateDesc')}
            </p>
          </div>
          <div className="theme-surface rounded-2xl p-6 border theme-border theme-shadow-sm">
            <h3 className="theme-text-primary font-semibold mb-2">{t('signInPage.discoverTitle')}</h3>
            <p className="theme-text-secondary text-sm">{t('signInPage.discoverDesc')}</p>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
