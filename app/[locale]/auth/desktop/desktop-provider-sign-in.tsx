"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { signIn } from "next-auth/react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import { planGoogleSignIn } from "@/lib/auth-host"
import { scrollShellClassName } from "@/components/scroll-shell"
import type { DesktopRedirectProvider } from "@/lib/auth/desktop-handoff"

interface Props {
  provider: DesktopRedirectProvider
  appName: string
  /** Back to /auth/desktop with the app's parameters, once signed in. */
  callbackUrl: string
  /** The generic sign-in page, for when the provider cannot be started here. */
  fallbackUrl: string
}

const PROVIDER_NAMES: Record<DesktopRedirectProvider, string> = {
  github: "GitHub",
  google: "Google",
  sso: "single sign-on",
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
            <span>Continuing to {PROVIDER_NAMES[provider]}</span>
          </CardTitle>
          <CardDescription className="theme-text-muted">
            Sign in, and you will come back here to finish signing in to {appName}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs theme-text-muted">
            Nothing happening?{" "}
            <Link href={fallbackUrl} className="underline">
              Choose another way to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
