"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, CheckCircle, Loader2 } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"

interface Props {
  clientId: string
  appName: string
  state: string
  codeChallenge: string
}

/**
 * The button that completes desktop hand-off sign-in.
 *
 * A click rather than an automatic redirect on load, for two reasons: browsers
 * refuse to navigate to a custom URL scheme without a user gesture, and the
 * user should see which application they are about to be signed into before it
 * happens.
 */
export function DesktopHandoffClient({ clientId, appName, state, codeChallenge }: Props) {
  const { t } = useTranslations()
  const [status, setStatus] = useState<"idle" | "working" | "handed-off" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handOff() {
    setStatus("working")
    setError(null)

    try {
      const response = await fetch("/api/auth/desktop/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: clientId,
          state,
          codeChallenge,
          codeChallengeMethod: "S256",
        }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        setError(body.error || t("desktopSignInPage.startFailed"))
        setStatus("error")
        return
      }

      const { redirectUrl } = await response.json()

      // The code is single-use and lives five minutes, so leaving this page on
      // screen afterwards is harmless — reusing the URL is not, and cannot work.
      setStatus("handed-off")
      window.location.href = redirectUrl
    } catch {
      setError(t("desktopSignInPage.unreachable"))
      setStatus("error")
    }
  }

  if (status === "handed-off") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle className="w-4 h-4 text-success" />
          <span>{t("desktopSignInPage.opening", { app: appName })}</span>
        </div>
        <p className="text-xs theme-text-muted">
          {t("desktopSignInPage.closeTab", { app: appName })}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Button onClick={handOff} disabled={status === "working"} className="w-full">
        {status === "working" ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {t("desktopSignInPage.preparing")}
          </>
        ) : (
          <>{t("desktopSignInPage.open", { app: appName })}</>
        )}
      </Button>

      {error && (
        <div className="flex items-start gap-2 text-sm text-danger">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
