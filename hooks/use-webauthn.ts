"use client"

import { useState, useCallback, useEffect } from "react"
import { startRegistration, startAuthentication } from "@simplewebauthn/browser"
import { safeResponseJson, hasRequiredFields } from "@/lib/safe-parse"
import { useTranslations } from "@/lib/i18n/client"

/**
 * A browser refusal (NotAllowedError, InvalidStateError, …) carries the
 * browser's English text; the reader gets the flow's own message in their
 * language instead (AWTD-1601). A server message passes through.
 *
 * `@simplewebauthn/browser` wraps most of these in a `WebAuthnError` whose
 * `cause` is the original DOMException and whose `code` is `ERROR_…`, so both
 * the bare and the wrapped forms count.
 */
export function isBrowserError(err: unknown): boolean {
  const isDomException = (value: unknown) =>
    typeof DOMException !== "undefined" && value instanceof DOMException
  if (isDomException(err)) return true
  if (!(err instanceof Error)) return false
  if (isDomException(err.cause)) return true
  const code = (err as { code?: unknown }).code
  return err.name === "WebAuthnError" || (typeof code === "string" && code.startsWith("ERROR_"))
}

export function useWebAuthn() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSupported, setIsSupported] = useState(false)
  const { t } = useTranslations()

  // Check WebAuthn support after hydration to avoid SSR mismatch
  useEffect(() => {
    setIsSupported(
      typeof window !== "undefined" &&
      window.PublicKeyCredential !== undefined
    )
  }, [])

  const registerPasskey = useCallback(async (email?: string, name?: string) => {
    if (!isSupported) {
      setError(t("passkeyErrors.notSupported"))
      return { success: false }
    }

    setIsLoading(true)
    setError(null)

    try {
      // Get registration options from server
      const optionsRes = await fetch("/api/auth/webauthn/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      const optionsData = await safeResponseJson<{
        options?: any
        sessionId?: string
        error?: string
      }>(optionsRes, { error: t("passkeyErrors.optionsFailed") })


      if (!optionsRes.ok) {
        throw new Error(optionsData.error || t("passkeyErrors.optionsFailed"))
      }

      const { options, sessionId } = optionsData

      // Start WebAuthn registration ceremony
      const credential = await startRegistration({ optionsJSON: options })

      // Verify with server
      const verifyRes = await fetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          response: credential,
          name: name || t("passkeyErrors.defaultName"),
        }),
      })

      const result = await safeResponseJson<{
        isNewUser?: boolean
        user?: any
        existingUser?: boolean
        email?: string
        error?: string
      }>(verifyRes, { error: t("passkeyErrors.registrationFailed") })

      // The account already existed. /register/options cannot say so without
      // becoming an enumeration oracle (task c2fbe8e4), so verify is where we
      // find out — switch to the sign-in ceremony.
      if (result.existingUser) {
        // Get authentication options
        const authOptionsRes = await fetch("/api/auth/webauthn/authenticate/options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: result.email || email }),
        })

        if (!authOptionsRes.ok) {
          const authData = await safeResponseJson<{ error?: string }>(
            authOptionsRes,
            { error: t("passkeyErrors.optionsFailed") }
          )
          throw new Error(authData.error || t("passkeyErrors.optionsFailed"))
        }

        const authData = await safeResponseJson<{
          options?: any
          sessionId?: string
        }>(authOptionsRes, {})

        if (!hasRequiredFields(authData, ['options', 'sessionId'])) {
          throw new Error(t("passkeyErrors.optionsFailed"))
        }

        const { options: authOptions, sessionId: authSessionId } = authData

        // Start WebAuthn authentication ceremony
        const authCredential = await startAuthentication({ optionsJSON: authOptions })

        // Verify with server
        const authVerifyRes = await fetch("/api/auth/webauthn/authenticate/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: authSessionId,
            response: authCredential,
          }),
        })

        if (!authVerifyRes.ok) {
          const verifyData = await safeResponseJson<{ error?: string }>(
            authVerifyRes,
            { error: t("passkeyErrors.authenticationFailed") }
          )
          throw new Error(verifyData.error || t("passkeyErrors.authenticationFailed"))
        }

        // Success — redirect to home
        window.location.href = "/"
        return { success: true, existingUser: true }
      }

      if (!verifyRes.ok) {
        throw new Error(result.error || t("passkeyErrors.registrationFailed"))
      }

      // For new users, they're now logged in - redirect to home
      // Use window.location.href to ensure session cookie is picked up
      if (result.isNewUser) {
        window.location.href = "/"
        return { success: true, isNewUser: true }
      }

      // For existing users adding a passkey, just return success
      return { success: true, user: result.user }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ""
      // Handle user cancellation gracefully
      if (message.includes("cancelled") || message.includes("canceled")) {
        setError(null)
        return { success: false, cancelled: true }
      }
      setError(message && !isBrowserError(err) ? message : t("passkeyErrors.registrationFailed"))
      return { success: false }
    } finally {
      setIsLoading(false)
    }
  }, [isSupported, t])

  const authenticateWithPasskey = useCallback(async (email?: string) => {
    if (!isSupported) {
      setError(t("passkeyErrors.notSupported"))
      return { success: false }
    }

    setIsLoading(true)
    setError(null)

    try {
      // Get authentication options from server
      const optionsRes = await fetch("/api/auth/webauthn/authenticate/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      if (!optionsRes.ok) {
        const data = await safeResponseJson<{ error?: string }>(
          optionsRes,
          { error: t("passkeyErrors.optionsFailed") }
        )
        throw new Error(data.error || t("passkeyErrors.optionsFailed"))
      }

      const optionsData = await safeResponseJson<{
        options?: any
        sessionId?: string
      }>(optionsRes, {})

      if (!hasRequiredFields(optionsData, ['options', 'sessionId'])) {
        throw new Error(t("passkeyErrors.optionsFailed"))
      }

      const { options, sessionId } = optionsData

      // Start WebAuthn authentication ceremony
      const credential = await startAuthentication({ optionsJSON: options })

      // Verify with server
      const verifyRes = await fetch("/api/auth/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          response: credential,
        }),
      })

      if (!verifyRes.ok) {
        const data = await safeResponseJson<{ error?: string }>(
          verifyRes,
          { error: t("passkeyErrors.authenticationFailed") }
        )
        throw new Error(data.error || t("passkeyErrors.authenticationFailed"))
      }

      const result = await safeResponseJson<{
        user?: any
      }>(verifyRes, {})

      // Track successful login

      // Full page redirect to ensure session cookie is picked up
      // router.refresh() + router.push() doesn't reliably pick up new cookies
      window.location.href = "/"

      return { success: true, user: result.user }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ""
      // Handle user cancellation gracefully
      if (message.includes("cancelled") || message.includes("canceled")) {
        setError(null)
        return { success: false, cancelled: true }
      }
      setError(message && !isBrowserError(err) ? message : t("passkeyErrors.authenticationFailed"))
      return { success: false }
    } finally {
      setIsLoading(false)
    }
  }, [isSupported, t])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    isSupported,
    isLoading,
    error,
    registerPasskey,
    authenticateWithPasskey,
    clearError,
  }
}
