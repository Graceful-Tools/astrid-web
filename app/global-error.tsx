"use client"

import { useEffect } from "react"
import { createLogger } from '@/lib/logger'
import { BRAND } from '@/lib/brand/config'

const log = createLogger('global-error.tsx')


interface GlobalErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Global error boundary that catches errors in the root layout.
 * This must define its own <html> and <body> tags since it replaces the root layout.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    log.error({ err: error }, "Global error:")
  }, [error])

  return (
    <html
      lang="en"
      // This page replaces the root layout, so it must set the brand accent
      // custom property itself or stylesheets that reference it paint nothing.
      style={{ '--brand-accent': BRAND.accentColor } as React.CSSProperties}
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
                stroke="#ef4444"
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
                Something went wrong
              </h1>
              <p style={{ color: "#6b7280", margin: 0, maxWidth: "400px" }}>
                A critical error occurred. Please try refreshing the page.
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
              Try again
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
              Go home
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
