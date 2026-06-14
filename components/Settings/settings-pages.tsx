"use client"

import React, { Suspense, lazy } from "react"
import { LoadingScreen } from "@/components/loading-screen"

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

export const SETTINGS_PAGE_TITLES: Record<string, string> = {
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

export type SettingsPageKey = keyof typeof SETTINGS_PAGE_TITLES

interface SettingsPageProps {
  onNavigate: (page: string) => void
}

export function renderSettingsPage(page: string, props: SettingsPageProps): React.ReactNode {
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

interface SettingsPageContentProps {
  page: string
  onNavigate: (page: string) => void
  fallback?: React.ReactNode
  notFound?: React.ReactNode
}

export function SettingsPageContent({ page, onNavigate, fallback, notFound }: SettingsPageContentProps) {
  const rendered = renderSettingsPage(page, { onNavigate })
  return (
    <Suspense fallback={fallback ?? <LoadingScreen />}>
      {rendered ?? notFound ?? null}
    </Suspense>
  )
}
