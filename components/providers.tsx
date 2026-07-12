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
import { PostHogProvider } from "@/components/posthog-provider"
import { OfflineProvider } from "@/components/offline-provider"
import { FeatureFlagProvider } from "@/contexts/feature-flag-context"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <FeatureFlagProvider>
       <PostHogProvider>
        <ThemeProvider>
          <SettingsProvider>
            <OfflineProvider>
              <CodingWorkflowProvider>
                <PWARegistration />
                <PWAStatus />
                {children}
                <Toaster />
                <PWAInstallPrompt />
              </CodingWorkflowProvider>
            </OfflineProvider>
          </SettingsProvider>
        </ThemeProvider>
       </PostHogProvider>
      </FeatureFlagProvider>
    </SessionProvider>
  )
}
