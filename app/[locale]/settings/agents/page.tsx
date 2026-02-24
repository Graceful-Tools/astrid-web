"use client"

export const dynamic = 'force-dynamic'

import { useEffect, Suspense } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingScreen } from "@/components/loading-screen"
import { AIAPIKeyManager } from "@/components/ai-api-key-manager"
import { OpenClawAgentManager } from "@/components/openclaw-agent-manager"
import {
  Brain,
  ArrowLeft,
  Sparkles,
  Cloud,
  FileText,
  Bot
} from "lucide-react"
import Image from "next/image"

function AgentsSettingsContent() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/auth/signin")
      return
    }
  }, [status, router])

  if (status === "loading") {
    return <LoadingScreen message="Loading AI settings..." />
  }

  if (!session?.user) {
    return <LoadingScreen message="Loading AI settings..." />
  }

  return (
    <div className="min-h-screen theme-bg-primary">
      {/* Header */}
      <div className="theme-header theme-border app-header">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <Button
            variant="ghost"
            onClick={() => router.push('/settings')}
            className="p-2 hover:bg-opacity-20"
          >
            <ArrowLeft className="w-5 h-5 theme-text-primary" />
          </Button>
          <div
            className="flex flex-wrap items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => router.push('/')}
            title="Go to Home"
          >
            <Image src="/icons/icon-96x96.png" alt="Astrid" width={24} height={24} className="rounded" />
            <span className="text-xl font-semibold theme-text-primary">astrid</span>
          </div>
          <div className="flex items-center space-x-1 theme-count-bg rounded-full px-3 py-1">
            <div className="w-2 h-2 theme-bg-tertiary rounded-full"></div>
            <span className="text-sm theme-text-primary">AI Agents</span>
          </div>
        </div>
      </div>

      {/* Settings Content */}
      <div className="p-2 sm:p-4">
        <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
          {/* Settings Page Header */}
          <div className="flex flex-wrap items-center gap-3">
            <Brain className="w-8 h-8 text-purple-500" />
            <div>
              <h1 className="text-2xl font-bold theme-text-primary">AI Agents</h1>
              <p className="theme-text-muted">Assign tasks to AI agents and get intelligent help</p>
            </div>
          </div>

          {/* Cloud Agents link */}
          <Card
            className="theme-bg-secondary theme-border cursor-pointer hover:scale-[1.02] transition-transform"
            onClick={() => router.push('/settings/coding-agents')}
          >
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
                  <Cloud className="w-8 h-8 text-indigo-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold theme-text-primary text-lg">
                    Cloud Agent Settings
                  </h3>
                  <p className="text-sm theme-text-muted mt-1">
                    Self-hosted SDK agents with GitHub integration
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* OpenClaw Agents */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex flex-wrap items-center gap-2">
                <Bot className="w-6 h-6 text-orange-500" />
                <span>OpenClaw Agents</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Connect your own AI agents via the OpenClaw protocol.
                Agents get OAuth credentials and communicate via REST + SSE.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OpenClawAgentManager />
            </CardContent>
          </Card>

          {/* AI Agent API Keys */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex flex-wrap items-center gap-2">
                <Sparkles className="w-6 h-6 text-yellow-500" />
                <span>Agent API Keys</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Add your API keys to enable AI agents (claude/openai/gemini@astrid.cc).
                You only need to configure one provider.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* API Key Configuration */}
              <AIAPIKeyManager />
            </CardContent>
          </Card>

          {/* List Instructions Tip */}
          <Card className="theme-bg-secondary theme-border border-dashed">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-medium theme-text-primary text-sm">Tip: Control agent behavior per list</h4>
                  <p className="text-sm theme-text-muted mt-1">
                    Each list&apos;s <strong>description</strong> is used as instructions for AI agents working on tasks in that list.
                    Write markdown in your list description to tell agents how to handle tasks — like a project brief.
                  </p>
                  <p className="text-xs theme-text-muted mt-2">
                    Edit descriptions in List Settings → Admin → Description
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function AgentsSettingsPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AgentsSettingsContent />
    </Suspense>
  )
}
