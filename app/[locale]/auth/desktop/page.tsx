/**
 * /auth/desktop — the browser half of desktop hand-off sign-in.
 *
 * A native app opens this page with the client it is, an opaque `state` it will
 * check on the way back, and the SHA-256 of a PKCE verifier it keeps to itself.
 * Signing in happens here, using everything the web already supports — passkey,
 * Google, Apple — so the app never handles a credential and gains no sign-in
 * surface of its own.
 *
 * An optional `provider` (github | google | sso) says which button the user
 * already tapped in the app; a signed-out user goes straight to it instead of
 * choosing again. Clients: windows, ios, mac, android (lib/auth/desktop-handoff.ts).
 *
 * Nothing on this page decides who the user is. The grant route reads that from
 * the session cookie; these parameters only say which application is asking.
 */

import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import Link from "next/link"
import { getUnifiedSession } from "@/lib/session-utils"
import { desktopSignInProvider, validateGrantRequest } from "@/lib/auth/desktop-handoff"
import { AUTH_PROVIDERS } from "@/lib/brand/capabilities"
import { DesktopHandoffClient } from "./desktop-handoff-client"
import { DesktopProviderSignIn } from "./desktop-provider-sign-in"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertTriangle, Laptop, Lock } from "lucide-react"
import { scrollShellClassName } from "@/components/scroll-shell"

type SearchParamMap = Record<string, string | string[] | undefined>

interface PageProps {
  searchParams: Promise<SearchParamMap>
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

async function InvalidLink({ reason }: { reason: string }) {
  const t = await getTranslations("desktopSignInPage")
  return (
    <div className={`${scrollShellClassName} theme-bg-primary flex items-center justify-center p-4`}>
      <Card className="max-w-lg w-full theme-bg-secondary theme-border">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-danger" />
            <span>{t("invalidTitle")}</span>
          </CardTitle>
          <CardDescription className="theme-text-muted">{reason}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm theme-text-muted mb-4">
            {t("invalidBody")}
          </p>
          <Button variant="outline" asChild>
            <Link href="/">{t("returnHome")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default async function DesktopHandoffPage({ searchParams }: PageProps) {
  const params = await searchParams

  // Validated with the same function the grant route uses, so a malformed link
  // fails here — on a page that can explain itself — rather than on a click.
  const validation = validateGrantRequest({
    client: one(params.client),
    state: one(params.state),
    codeChallenge: one(params.code_challenge),
    codeChallengeMethod: one(params.code_challenge_method),
  })

  if (!validation.ok) {
    return <InvalidLink reason={validation.error} />
  }

  const { client, state, codeChallenge } = validation.value

  const session = await getUnifiedSession()
  if (!session?.user?.id) {
    // Round-trip through the normal sign-in page, then come back here with the
    // app's parameters intact.
    const query = new URLSearchParams({
      client: client.id,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    })
    const callbackUrl = `/auth/desktop?${query.toString()}`
    const signInUrl = `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`

    // The app already asked which provider (AWTD-1105) — start it directly
    // rather than make the user choose again.
    const provider = desktopSignInProvider(one(params.provider), AUTH_PROVIDERS)
    if (provider) {
      return (
        <DesktopProviderSignIn
          provider={provider}
          appName={client.name}
          callbackUrl={callbackUrl}
          fallbackUrl={signInUrl}
        />
      )
    }
    redirect(signInUrl)
  }

  const t = await getTranslations("desktopSignInPage")

  return (
    <div className={`${scrollShellClassName} theme-bg-primary flex items-center justify-center p-4`}>
      <Card className="max-w-lg w-full theme-bg-secondary theme-border">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Laptop className="w-5 h-5" />
            <span>{t("title", { app: client.name })}</span>
          </CardTitle>
          <CardDescription className="theme-text-muted">
            {t("signedInAs", { email: session.user.email ?? "" })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <DesktopHandoffClient
            clientId={client.id}
            appName={client.name}
            state={state}
            codeChallenge={codeChallenge}
          />

          <div className="flex items-start gap-2 text-xs theme-text-muted">
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              {t("codeNote")}
            </span>
          </div>

          <p className="text-xs theme-text-muted">
            {t("notExpecting")}{" "}
            <Link href="/" className="underline">
              {t("closePage")}
            </Link>{" "}
            {t("nothingHandedOver")}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
