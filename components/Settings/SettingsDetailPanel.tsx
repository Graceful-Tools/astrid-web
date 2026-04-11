"use client"

import React, { Suspense, lazy, useState, useEffect, useRef } from "react"
import { LoadingScreen } from "@/components/loading-screen"
import { Maximize2 } from "lucide-react"

const AccountSettings = lazy(() => import("./AccountSettings"))
const AppearanceSettings = lazy(() => import("./AppearanceSettings"))
const RemindersSettings = lazy(() => import("./RemindersSettings"))
const AgentsSettings = lazy(() => import("./AgentsSettings"))
const ApiAccessSettings = lazy(() => import("./ApiAccessSettings"))
const ContactsSettings = lazy(() => import("./ContactsSettings"))
const DebugSettings = lazy(() => import("./DebugSettings"))
const CodingIntegrationSettings = lazy(() => import("./CodingIntegrationSettings"))
const CodingAgentsSettings = lazy(() => import("./CodingAgentsSettings"))
const TasksSettings = lazy(() => import("./TasksSettings"))
const ApiTestingSettings = lazy(() => import("./ApiTestingSettings"))
const GithubSetupSettings = lazy(() => import("./GithubSetupSettings"))
const HelpPage = lazy(() => import("./HelpPage"))
const PrivacyPage = lazy(() => import("./PrivacyPage"))
const TermsPage = lazy(() => import("./TermsPage"))

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
  'agents/github-setup': 'GitHub Setup',
  'help': 'Help & Support',
  'privacy': 'Privacy Policy',
  'terms': 'Terms of Service',
}

interface SettingsDetailPanelProps {
  page: string
  onNavigate: (page: string) => void
  onClose: () => void
}

export default function SettingsDetailPanel({ page, onNavigate, onClose }: SettingsDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [arrowTop, setArrowTop] = useState(80)

  // Calculate arrow position to point at the source settings card
  useEffect(() => {
    const updateArrowPosition = () => {
      try {
        const sourceCard = document.querySelector(`[data-settings-page="${page}"]`) as HTMLElement
        const panelElement = panelRef.current

        if (!sourceCard || !panelElement) return

        const cardRect = sourceCard.getBoundingClientRect()
        const panelRect = panelElement.getBoundingClientRect()

        if (cardRect.height > 0) {
          const cardCenter = cardRect.top + cardRect.height / 2
          const panelTop = panelRect.top
          const relativePosition = cardCenter - panelTop
          const arrowOffset = 10
          const minTop = 20
          const maxTop = panelRect.height - 40
          const finalTop = Math.max(minTop, Math.min(maxTop, relativePosition - arrowOffset))
          setArrowTop(finalTop)
        }
      } catch {
        // Silently handle errors
      }
    }

    updateArrowPosition()
    const rafId = requestAnimationFrame(updateArrowPosition)

    // Listen for scroll on the settings list container
    const sourceCard = document.querySelector(`[data-settings-page="${page}"]`) as HTMLElement
    const scrollContainer = sourceCard?.closest('.overflow-y-auto')
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', updateArrowPosition, { passive: true })
    }

    window.addEventListener('resize', updateArrowPosition, { passive: true })

    return () => {
      cancelAnimationFrame(rafId)
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', updateArrowPosition)
      }
      window.removeEventListener('resize', updateArrowPosition)
    }
  }, [page])

  function renderPage() {
    const props = { onNavigate }
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
      case "agents/github-setup": return <GithubSetupSettings {...props} />
      case "help": return <HelpPage {...props} />
      case "privacy": return <PrivacyPage {...props} />
      case "terms": return <TermsPage {...props} />
      default: return null
    }
  }

  return (
    <>
      <div
        className="task-panel-arrow theme-panel-arrow"
        style={{ top: `${arrowTop}px`, transition: 'top 0.15s ease-out' }}
      ></div>
      <div ref={panelRef} className="w-full theme-panel flex flex-col h-full relative" data-task-detail-panel>
        {/* Open in new tab button */}
        <div className="flex items-center justify-end px-3 pt-2 flex-shrink-0">
          <button
            onClick={() => window.open(`/settings/fullpage/${page}`, '_blank')}
            className="p-1.5 rounded-lg theme-text-muted hover:theme-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title="Open in new tab"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <Suspense fallback={<LoadingScreen />}>
            {renderPage()}
          </Suspense>
        </div>
      </div>
    </>
  )
}
