"use client"

import type React from "react"
import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "@/contexts/theme-context"
import { BRAND } from "@/lib/brand/config"
import { SettingsProvider } from "@/contexts/settings-context"
// SSEProvider removed - now using centralized SSE Manager
import { PWARegistration } from "@/components/pwa-registration"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
// Stays eager so it hears an `offline` that fires before any deferred chunk arrives; it
// loads the offline queue itself, on demand (AWTD-1604).
import { PWAStatus } from "@/components/pwa-status"
import { FeatureFlagProvider } from "@/contexts/feature-flag-context"
import { EditingSessionProvider } from "@/hooks/use-editing-session"
import { WebVitalsReporter } from "@/components/web-vitals-reporter"
import { LocaleSync } from "@/components/locale-sync"
import dynamic from "next/dynamic"

// Loaded after hydration, so the Waiting prompt costs no first-load JS (AWTD-1593).
const WaitingPromptHost = dynamic(() => import("@/components/WaitingPromptHost").then(m => m.WaitingPromptHost), { ssr: false })

// Background work that draws nothing on first paint, loaded after hydration (AWTD-1604).
// Each statically imported the offline database (Dexie), the cache and sync managers, the
// SSE manager and pino into EVERY page's first load. All of it already ran in effects, i.e.
// after mount; now it runs once its chunk arrives, a moment later.
// - Offline sync: nothing reads OfflineContext (useOffline has no consumers), so it no
//   longer needs to wrap the tree; it is mounted beside it.
const OfflineProvider = dynamic(() => import("@/components/offline-provider").then(m => m.OfflineProvider), { ssr: false })
// - Coding-workflow SSE listener: was a pass-through provider around the tree.
const CodingWorkflowListener = dynamic(() => import("@/components/coding-workflow-provider").then(m => m.CodingWorkflowListener), { ssr: false })
// - The toast viewport: empty until something calls toast(). A toast raised before it loads
//   is not lost: hooks/use-toast.ts keeps it in its module store, which useToast() starts from.
const Toaster = dynamic(() => import("@/components/ui/toaster").then(m => m.Toaster), { ssr: false })

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {/* Core Web Vitals (AWTD-904). Inside SessionProvider because it labels
          each sample anonymous vs signed-in, and at this level rather than on
          individual routes so it covers the task list and the marketing pages
          alike — the same reach <SpeedInsights /> has in the root layout. */}
      <WebVitalsReporter />
      {/* The signed-in user's language, for notifications and emails (AWTD-1592). */}
      <LocaleSync />
      <FeatureFlagProvider>
        <ThemeProvider defaultTheme={BRAND.defaultTheme}>
          <SettingsProvider>
            <OfflineProvider>{null}</OfflineProvider>
            <CodingWorkflowListener />
            {/* One editing session for the whole app (task 7b60c7c5): opening
                any editor commits and closes the active one, wherever it lives. */}
            <EditingSessionProvider>
              <PWARegistration />
              <PWAStatus />
              {children}
              <Toaster />
              {/* The one Waiting prompt: "waiting until… / waiting on…" (lib/waiting-prompt.ts). */}
              <WaitingPromptHost />
              <PWAInstallPrompt />
            </EditingSessionProvider>
          </SettingsProvider>
        </ThemeProvider>
      </FeatureFlagProvider>
    </SessionProvider>
  )
}
