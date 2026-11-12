"use client"

export const dynamic = 'force-dynamic'

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { LoadingScreen } from "@/components/loading-screen"
import { ArrowLeft } from "lucide-react"
import { SettingsPageContent, SETTINGS_PAGE_TITLES } from "@/components/Settings/settings-pages"
import { scrollShellClassName } from "@/components/scroll-shell"
import { useTranslations } from "@/lib/i18n/client"

/**
 * The header title of each page, as an i18n key. SETTINGS_PAGE_TITLES holds the
 * same names in English only; it stays the fallback for a page not listed here.
 */
const PAGE_TITLE_KEYS: Record<string, string> = {
  'account': 'settingsPages.pageTitles.account',
  'appearance': 'settingsPages.appearance.title',
  'reminders': 'settingsPages.remindersNotifications.title',
  'agents': 'settingsPages.aiAgents.title',
  'connections': 'settingsPages.connections.title',
  'api-access': 'settingsPages.connections.title',
  'contacts': 'settingsPages.contacts.title',
  'debug': 'settingsPages.debug.title',
  'tasks': 'settingsPages.tasksPage.title',
  'api-testing': 'settingsPages.pageTitles.apiTesting',
  'agents/github-setup': 'settingsPages.pageTitles.githubSetup',
  'help': 'settingsPages.pageTitles.help',
  'privacy': 'signInPage.privacyPolicy',
  'terms': 'signInPage.termsOfService',
}

export default function SettingsFullPage() {
  const { t } = useTranslations()
  const params = useParams()
  const router = useRouter()
  const { status } = useSession()
  const page = (params?.page as string) || ''

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin")
    }
  }, [status, router])

  if (status !== "authenticated") {
    return <LoadingScreen />
  }

  const title = PAGE_TITLE_KEYS[page] ? t(PAGE_TITLE_KEYS[page]) : SETTINGS_PAGE_TITLES[page] || page

  // Opened via window.open, this tab has no history — router.back() is a
  // silent no-op. Fall through to the in-app settings page instead.
  const goBack = () => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push(`/settings/${page}`)
    }
  }

  return (
    // The app shell locks html/body scrolling, so this standalone page must own
    // its scroll surface — without it everything below the fold is unreachable.
    // (components/scroll-shell.tsx documents the pattern.)
    <div className={`${scrollShellClassName} theme-bg-primary theme-text-primary`}>
      <div className="border-b theme-border px-6 py-3 flex items-center gap-3 sticky top-0 theme-bg-secondary z-10">
        <button
          onClick={goBack}
          className="p-1.5 rounded-lg hover:bg-[rgb(var(--theme-surface-hover))] transition-colors"
          title={t('actions.back')}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-base font-medium tracking-tight">{title}</h1>
      </div>

      <div className="max-w-3xl mx-auto py-6">
        <SettingsPageContent
          page={page}
          onNavigate={() => {}}
          notFound={<div className="p-8 text-center theme-text-muted">{t('errorPages.pageNotFound')}</div>}
        />
      </div>
    </div>
  )
}
