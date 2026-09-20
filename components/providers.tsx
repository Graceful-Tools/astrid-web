"use client"

import type React from "react"
import { SessionProvider } from "next-auth/react"
import { Toaster } from "@/components/ui/toaster"
import { ThemeProvider } from "@/contexts/theme-context"
import { SettingsProvider } from "@/contexts/settings-context"
// SSEProvider removed - now using centralized SSE Manager
import { PWARegistration } from "@/components/pwa-registration"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { PWAStatus } from "@/components/pwa-status"
import { CodingWorkflowProvider } from "@/components/coding-workflow-provider"
import { OfflineProvider } from "@/components/offline-provider"
import { FeatureFlagProvider } from "@/contexts/feature-flag-context"
import { EditingSessionProvider } from "@/hooks/use-editing-session"
import { WebVitalsReporter } from "@/components/web-vitals-reporter"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {/* Core Web Vitals (AWTD-904). Inside SessionProvider because it labels
          each sample anonymous vs signed-in, and at this level rather than on
          individual routes so it covers the task list and the marketing pages
          alike — the same reach <SpeedInsights /> has in the root layout. */}
      <WebVitalsReporter />
      <FeatureFlagProvider>
        <ThemeProvider>
          <SettingsProvider>
            <OfflineProvider>
              <CodingWorkflowProvider>
                {/* One editing session for the whole app (task 7b60c7c5): opening
                    any editor commits and closes the active one, wherever it lives. */}
                <EditingSessionProvider>
                  <PWARegistration />
                  <PWAStatus />
                  {children}
                  <Toaster />
                  <PWAInstallPrompt />
                </EditingSessionProvider>
              </CodingWorkflowProvider>
            </OfflineProvider>
          </SettingsProvider>
        </ThemeProvider>
      </FeatureFlagProvider>
    </SessionProvider>
  )
}
