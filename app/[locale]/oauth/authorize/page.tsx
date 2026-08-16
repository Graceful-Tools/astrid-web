"use server"

import { BRAND } from '@/lib/brand/config'
import Link from "next/link"
import { redirect } from "next/navigation"
import { getUnifiedSession } from "@/lib/session-utils"
import {
  buildErrorRedirect,
  createAuthorizationRedirect,
  OAuthAuthorizationError,
  validateAuthorizationRequest,
} from "@/lib/oauth/oauth-authorization"
import { formatScopeString, getScopeDescription } from "@/lib/oauth/oauth-scopes"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, CheckCircle, Lock, Shield } from "lucide-react"

type SearchParamMap = Record<string, string | string[] | undefined>

interface PageProps {
  searchParams: Promise<SearchParamMap>
}

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function buildQueryString(params: SearchParamMap): string {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(v => v && sp.append(key, v))
    } else if (value) {
      sp.append(key, value)
    }
  })
  return sp.toString()
}

export default async function OAuthAuthorizePage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams
  const session = await getUnifiedSession()
  const queryString = buildQueryString(resolvedSearchParams)
  const callbackPath = `/oauth/authorize${queryString ? `?${queryString}` : ""}`

  if (!session?.user?.id) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callbackPath)}`)
  }

  const params = {
    clientId: normalizeParam(resolvedSearchParams.client_id),
    redirectUri: normalizeParam(resolvedSearchParams.redirect_uri),
    scope: normalizeParam(resolvedSearchParams.scope),
    state: normalizeParam(resolvedSearchParams.state),
    responseType: normalizeParam(resolvedSearchParams.response_type),
    codeChallenge: normalizeParam(resolvedSearchParams.code_challenge),
    codeChallengeMethod: normalizeParam(resolvedSearchParams.code_challenge_method),
  }

  let context = null
  let validationError: OAuthAuthorizationError | null = null

  try {
    context = await validateAuthorizationRequest(params)
  } catch (error) {
    if (error instanceof OAuthAuthorizationError) {
      validationError = error
    } else {
      throw error
    }
  }

  if (validationError || !context) {
    return (
      <div className="min-h-screen theme-bg-primary flex items-center justify-center p-4">
        <Card className="max-w-lg w-full theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <span>Unable to Continue</span>
            </CardTitle>
            <CardDescription className="theme-text-muted">
              {validationError?.message || "The authorization request is invalid. Please double-check the link and try again."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {validationError && (
              <div className="text-xs theme-text-muted">
                Error code: <code className="px-1 rounded theme-bg-tertiary">{validationError.code}</code>
              </div>
            )}
            <div className="pt-2 flex flex-col sm:flex-row gap-2">
              <Button asChild className="flex-1">
                <Link href="/settings/api-access">Go to API Access</Link>
              </Button>
              <Button variant="outline" asChild className="flex-1">
                <Link href="/">Return Home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  async function authorizeApp(formData: FormData) {
    "use server"

    const currentSession = await getUnifiedSession()
    if (!currentSession?.user?.id) {
      redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callbackPath)}`)
    }

    const clientId = formData.get("client_id")?.toString()
    const redirectUri = formData.get("redirect_uri")?.toString()
    const scope = formData.get("scope")?.toString()
    const state = formData.get("state")?.toString()
    const decision = formData.get("decision")?.toString() || "deny"
    const codeChallenge = formData.get("code_challenge")?.toString()
    const codeChallengeMethod = formData.get("code_challenge_method")?.toString()

    const requestContext = await validateAuthorizationRequest({
      clientId,
      redirectUri,
      scope,
      state,
      responseType: "code",
      codeChallenge,
      codeChallengeMethod,
    })

    if (decision === "deny") {
      const denialUrl = buildErrorRedirect(requestContext, "access_denied", "User denied the request")
      redirect(denialUrl)
    }

    const { redirectUrl } = await createAuthorizationRedirect(
      currentSession.user.id,
      requestContext
    )

    redirect(redirectUrl)
  }

  const scopeSummary = formatScopeString(context.scopes)

  return (
    <div className="min-h-screen theme-bg-primary">
      <div className="theme-header theme-border app-header">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2">
            <Lock className="w-5 h-5 theme-text-primary" />
            <span className="font-semibold theme-text-primary">Authorize {BRAND.appName} Integration</span>
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{context.client.name}</span>
                <Badge variant="secondary" className="text-xs">OAuth App</Badge>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                {context.client.description || `This application is requesting access to your ${BRAND.appName} account.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm">
                <div className="font-medium theme-text-primary">Requesting access as</div>
                <div className="text-sm theme-text-muted">
                  {session.user?.email || session.user?.name || "Your account"}
                </div>
              </div>
              <div className="text-xs theme-text-muted">
                {context.client.owner
                  ? `Developed by ${context.client.owner.email || context.client.owner.name || `${BRAND.appName} user`}`
                  : 'Dynamically registered by your MCP client'}
              </div>
            </CardContent>
          </Card>

          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Shield className="w-5 h-5 text-blue-500" />
                <span>Requested Permissions</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                This app will be able to:
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-2">
                {context.scopes.map(scope => (
                  <li key={scope} className="flex items-start space-x-3">
                    <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <code className="text-xs theme-bg-tertiary px-2 py-0.5 rounded">{scope}</code>
                      <div className="text-sm theme-text-muted">{getScopeDescription(scope)}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="text-xs theme-text-muted">
                Scope: <code className="theme-bg-tertiary px-1 rounded">{scopeSummary}</code>
              </div>
            </CardContent>
          </Card>

          <Card className="theme-bg-secondary theme-border border-green-500/40">
            <CardHeader>
              <CardTitle>Grant Access</CardTitle>
              <CardDescription className="theme-text-muted">
                Allow {context.client.name} to access your {BRAND.appName} data with the permissions above.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={authorizeApp} className="space-y-4">
                <input type="hidden" name="client_id" value={context.client.clientId} />
                <input type="hidden" name="redirect_uri" value={context.redirectUri} />
                <input type="hidden" name="scope" value={scopeSummary} />
                {context.state && <input type="hidden" name="state" value={context.state} />}
                {context.codeChallenge && (
                  <>
                    <input type="hidden" name="code_challenge" value={context.codeChallenge} />
                    <input type="hidden" name="code_challenge_method" value="S256" />
                  </>
                )}
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    variant="outline"
                    type="submit"
                    name="decision"
                    value="deny"
                    className="flex-1"
                  >
                    Deny
                  </Button>
                  <Button
                    type="submit"
                    name="decision"
                    value="approve"
                    className="flex-1"
                  >
                    Approve Access
                  </Button>
                </div>
              </form>
              <p className="text-xs theme-text-muted">
                Tokens expire after 1 hour. Refresh tokens remain valid for 30 days or until revoked from Settings → API Access.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
