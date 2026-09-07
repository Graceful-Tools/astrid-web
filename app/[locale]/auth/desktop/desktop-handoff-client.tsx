"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, CheckCircle, Loader2 } from "lucide-react"

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
        setError(body.error || "Could not start the hand-off. Please try again.")
        setStatus("error")
        return
      }

      const { redirectUrl } = await response.json()

      // The code is single-use and lives five minutes, so leaving this page on
      // screen afterwards is harmless — reusing the URL is not, and cannot work.
      setStatus("handed-off")
      window.location.href = redirectUrl
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
      setStatus("error")
    }
  }

  if (status === "handed-off") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <span>Opening {appName}…</span>
        </div>
        <p className="text-xs theme-text-muted">
          You can close this tab. If {appName} did not open, return to it and start sign-in again.
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
            Preparing…
          </>
        ) : (
          <>Open {appName}</>
        )}
      </Button>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-500">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
