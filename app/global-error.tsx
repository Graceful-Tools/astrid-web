"use client"

import { useEffect, useState } from "react"
import { logBoundaryError } from '@/lib/log-boundary-error'
import { BRAND } from '@/lib/brand/config'
import { DANGER_COLOR } from '@/lib/brand/colors'
import { brandAccentCssVars } from '@/lib/brand/css-vars'
import { GLOBAL_ERROR_ENGLISH } from '@/lib/i18n/global-error-english'

interface GlobalErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Global error boundary that catches errors in the root layout.
 * This must define its own <html> and <body> tags since it replaces the root layout.
 *
 * It renders without the translation providers, so its words come from a static lookup
 * keyed by the locale in the address (AWTD-1613), not from t(). The lookup is imported on
 * render, not with the page, because this page is in every route's first load.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    logBoundaryError('global-error.tsx', error, "Global error:")
  }, [error])

  const [{ locale, copy }, setLanguage] = useState({ locale: "en", copy: GLOBAL_ERROR_ENGLISH })
  useEffect(() => {
    import('@/lib/i18n/global-error-messages')
      .then(({ GLOBAL_ERROR_MESSAGES, globalErrorLocale }) => {
        const found = globalErrorLocale(window.location.pathname)
        setLanguage({ locale: found, copy: GLOBAL_ERROR_MESSAGES[found] })
      })
      // If even this cannot load, the page stays in English.
      .catch(() => {})
  }, [])

  return (
    <html
      lang={locale}
      // This page replaces the root layout, so it must set the brand accent
      // custom property itself or stylesheets that reference it paint nothing.
      style={brandAccentCssVars() as React.CSSProperties}
    >
      <body>
        <div style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "24px",
          padding: "24px",
          fontFamily: "system-ui, -apple-system, sans-serif"
        }}>
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
            textAlign: "center"
          }}>
            <div style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              backgroundColor: "#fef2f2",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke={DANGER_COLOR}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: "24px", fontWeight: "bold", margin: "0 0 8px 0" }}>
                {copy.title}
              </h1>
              <p style={{ color: "#6b7280", margin: 0, maxWidth: "400px" }}>
                {copy.description}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={reset}
              style={{
                padding: "10px 20px",
                borderRadius: "6px",
                border: "1px solid #e5e7eb",
                backgroundColor: "white",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "500"
              }}
            >
              {copy.tryAgain}
            </button>
            <button
              onClick={() => window.location.href = "/"}
              style={{
                padding: "10px 20px",
                borderRadius: "6px",
                border: "none",
                backgroundColor: BRAND.accentColor,
                color: "white",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "500"
              }}
            >
              {copy.goHome}
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
