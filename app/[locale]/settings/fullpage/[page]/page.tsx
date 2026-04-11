"use client"

export const dynamic = 'force-dynamic'

import { Suspense, lazy } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { LoadingScreen } from "@/components/loading-screen"
import { ArrowLeft } from "lucide-react"

const AccountSettings = lazy(() => import("@/components/Settings/AccountSettings"))
const AppearanceSettings = lazy(() => import("@/components/Settings/AppearanceSettings"))
const RemindersSettings = lazy(() => import("@/components/Settings/RemindersSettings"))
const AgentsSettings = lazy(() => import("@/components/Settings/AgentsSettings"))
const ApiAccessSettings = lazy(() => import("@/components/Settings/ApiAccessSettings"))
const ContactsSettings = lazy(() => import("@/components/Settings/ContactsSettings"))
const DebugSettings = lazy(() => import("@/components/Settings/DebugSettings"))
const CodingIntegrationSettings = lazy(() => import("@/components/Settings/CodingIntegrationSettings"))
const CodingAgentsSettings = lazy(() => import("@/components/Settings/CodingAgentsSettings"))
const TasksSettings = lazy(() => import("@/components/Settings/TasksSettings"))
const ApiTestingSettings = lazy(() => import("@/components/Settings/ApiTestingSettings"))
const GithubSetupSettings = lazy(() => import("@/components/Settings/GithubSetupSettings"))
const HelpPage = lazy(() => import("@/components/Settings/HelpPage"))
const PrivacyPage = lazy(() => import("@/components/Settings/PrivacyPage"))
const TermsPage = lazy(() => import("@/components/Settings/TermsPage"))

const PAGE_TITLES: Record<string, string> = {
  'account': 'Account Access',
  'appearance': 'Appearance',
  'reminders': 'Reminders & Notifications',
  'agents': 'AI Agents',
  'api-access': 'API Access',
  'contacts': 'Contacts',
  'debug': 'Debug',
  'coding-integration': 'Coding Integration',
  'coding-agents': 'Cloud Agents',
  'tasks': 'Task Settings',
  'api-testing': 'API Testing',
  'help': 'Help & Support',
  'privacy': 'Privacy Policy',
  'terms': 'Terms of Service',
}

function renderPage(page: string) {
  const props = { onNavigate: () => {} }
  switch (page) {
    case "account": return <AccountSettings {...props} />
    case "appearance": return <AppearanceSettings {...props} />
    case "reminders": return <RemindersSettings {...props} />
    case "agents": return <AgentsSettings {...props} />
    case "api-access": return <ApiAccessSettings {...props} />
    case "contacts": return <ContactsSettings {...props} />
    case "debug": return <DebugSettings {...props} />
    case "coding-integration": return <CodingIntegrationSettings {...props} />
    case "coding-agents": return <CodingAgentsSettings {...props} />
    case "tasks": return <TasksSettings {...props} />
    case "api-testing": return <ApiTestingSettings {...props} />
    case "help": return <HelpPage {...props} />
    case "privacy": return <PrivacyPage {...props} />
    case "terms": return <TermsPage {...props} />
    default: return <div className="p-8 text-center theme-text-muted">Page not found</div>
  }
}

export default function SettingsFullPage() {
  const params = useParams()
  const router = useRouter()
  const { status } = useSession()
  const page = (params?.page as string) || ''

  if (status === "loading") {
    return <LoadingScreen />
  }

  if (status === "unauthenticated") {
    router.push("/auth/signin")
    return <LoadingScreen />
  }

  const title = PAGE_TITLES[page] || page

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Minimal header with back button */}
      <div className="border-b px-6 py-3 flex items-center gap-3">
        <button
          onClick={() => window.close()}
          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          title="Close"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-base font-medium tracking-tight">{title}</h1>
      </div>

      {/* Settings content */}
      <div className="max-w-3xl mx-auto py-6">
        <Suspense fallback={<LoadingScreen />}>
          {renderPage(page)}
        </Suspense>
      </div>
    </div>
  )
}
