"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { signIn } from "next-auth/react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import { planGoogleSignIn } from "@/lib/auth-host"
import { scrollShellClassName } from "@/components/scroll-shell"
import type { DesktopRedirectProvider } from "@/lib/auth/desktop-handoff"
import { useTranslations } from "@/lib/i18n/client"

interface Props {
  provider: DesktopRedirectProvider
  appName: string
  /** Back to /auth/desktop with the app's parameters, once signed in. */
  callbackUrl: string
  /** The generic sign-in page, for when the provider cannot be started here. */
  fallbackUrl: string
}

/** Brand names as they are; `sso` has no name of its own, so it is a translated phrase. */
const PROVIDER_NAMES: Record<Exclude<DesktopRedirectProvider, "sso">, string> = {
  github: "GitHub",
  google: "Google",
}

/**
 * Starts the provider the app already asked for (AWTD-1105).
 *
 * The user picked "Sign in with GitHub" in the native app; making them pick it
 * again on the generic sign-in page is a second, pointless choice. Unlike the
 * hand-off button this needs no user gesture — it is an ordinary https
 * navigation, not a custom URL scheme.
 */
export function DesktopProviderSignIn({ provider, appName, callbackUrl, fallbackUrl }: Props) {
  const { t } = useTranslations()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    // Google's redirect URI is registered for the canonical host only; the
    // generic sign-in page knows how to bounce a preview there.
    if (provider === "google" && planGoogleSignIn(window.location.origin).mode === "redirect") {
      window.location.href = fallbackUrl
      return
    }

    signIn(provider, { callbackUrl }).catch(() => {
      window.location.href = fallbackUrl
    })
  }, [provider, callbackUrl, fallbackUrl])

  return (
    <div className={`${scrollShellClassName} theme-bg-primary flex items-center justify-center p-4`}>
      <Card className="max-w-lg w-full theme-bg-secondary theme-border">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>
              {t("desktopSignInPage.continuingTo", {
                provider: provider === "sso" ? t("desktopSignInPage.singleSignOn") : PROVIDER_NAMES[provider],
              })}
            </span>
          </CardTitle>
          <CardDescription className="theme-text-muted">
            {t("desktopSignInPage.comeBack", { app: appName })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs theme-text-muted">
            {t("desktopSignInPage.nothingHappening")}{" "}
            <Link href={fallbackUrl} className="underline">
              {t("desktopSignInPage.chooseAnother")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
