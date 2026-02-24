"use client"

export const dynamic = 'force-dynamic'

import { useEffect, Suspense, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingScreen } from "@/components/loading-screen"
import { WebhookSettingsManager } from "@/components/webhook-settings-manager"
import { GitHubIntegrationSettings } from "@/components/github-integration-settings"
import { GitHubSharedSetup } from "@/components/github-shared-setup"
import {
  ArrowLeft,
  Server,
  Github,
  Info,
  Webhook,
  Terminal,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ExternalLink
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"

function CodingAgentsContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [showGitHub, setShowGitHub] = useState(false)

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/auth/signin")
      return
    }
  }, [status, router])

  if (status === "loading") {
    return <LoadingScreen message="Loading coding agents settings..." />
  }

  if (!session?.user) {
    return <LoadingScreen message="Loading coding agents settings..." />
  }

  return (
    <div className="min-h-screen theme-bg-primary">
      {/* Header */}
      <div className="theme-header theme-border app-header">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <Button
            variant="ghost"
            onClick={() => router.push('/settings/agents')}
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
            <span className="text-sm theme-text-primary">Coding Agents</span>
          </div>
        </div>
      </div>

      {/* Settings Content */}
      <div className="p-2 sm:p-4">
        <div className="max-w-sm sm:max-w-4xl mx-auto space-y-4 sm:space-y-6">
          {/* Settings Page Header */}
          <div className="flex flex-wrap items-center gap-3">
            <Server className="w-8 h-8 text-indigo-500" />
            <div>
              <h1 className="text-2xl font-bold theme-text-primary">Coding Agents</h1>
              <p className="theme-text-muted">Self-hosted AI agents for code generation and GitHub workflows</p>
            </div>
          </div>

          {/* Overview Card */}
          <Card className="theme-bg-secondary border-indigo-500/30 border">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-indigo-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm theme-text-primary font-medium">
                    Run AI coding agents on your own infrastructure
                  </p>
                  <p className="text-sm theme-text-muted mt-1">
                    The Astrid SDK lets you run Claude, OpenAI, or Gemini coding agents that can read/write files,
                    run commands, and create GitHub pull requests. Agents process tasks assigned to them in Astrid.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <span className="inline-flex items-center gap-1 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-1 rounded">
                      <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                      claude@astrid.cc
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-1 rounded">
                      <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                      openai@astrid.cc
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded">
                      <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                      gemini@astrid.cc
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* OpenClaw Section */}
          <Card
            className="theme-bg-secondary border-orange-500/50 border cursor-pointer hover:scale-[1.01] transition-transform"
            onClick={() => router.push('/settings/agents')}
          >
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <span className="text-3xl">🦞</span>
                  <div>
                    <p className="text-sm theme-text-primary font-medium flex items-center gap-2">
                      OpenClaw
                    </p>
                    <p className="text-sm theme-text-muted mt-1">
                      Run Claude Code on your own machine. Configure your gateway URL in{' '}
                      <span className="inline-flex items-center gap-1 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded">
                        AI Agents → API Keys
                      </span>
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 theme-text-muted flex-shrink-0" />
              </div>
            </CardContent>
          </Card>

          {/* Quick Start */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center gap-2">
                <Terminal className="w-5 h-5 text-green-500" />
                Astrid SDK Quick Start
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Install the Astrid SDK and start running coding agents
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium theme-text-primary mb-2">1. Install the SDK</p>
                  <code className="block p-3 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono">
                    npm install -g @gracefultools/astrid-sdk
                  </code>
                </div>

                <div>
                  <p className="text-sm font-medium theme-text-primary mb-2">2. Set environment variables</p>
                  <code className="block p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono whitespace-pre-wrap">
{`# AI Provider (at least one)
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GEMINI_API_KEY=AIza...

# Astrid OAuth credentials (from API Access settings)
ASTRID_OAUTH_CLIENT_ID=your-client-id
ASTRID_OAUTH_CLIENT_SECRET=your-secret
ASTRID_OAUTH_LIST_ID=your-list-id`}
                  </code>
                </div>

                <div>
                  <p className="text-sm font-medium theme-text-primary mb-2">3. Start the agent</p>
                  <div className="space-y-3">
                    <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                      <p className="text-sm font-medium text-purple-700 dark:text-purple-300 mb-1">
                        Terminal Mode (Recommended for local dev)
                      </p>
                      <p className="text-xs theme-text-muted mb-2">
                        Uses your local Claude Code CLI. Remote control your local Claude Code from Astrid!
                      </p>
                      <code className="block p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono">
                        npx astrid-agent --terminal
                      </code>
                      <p className="text-xs theme-text-muted mt-2">
                        Options: <code className="text-xs">--model=sonnet</code> <code className="text-xs">--cwd=/path/to/project</code>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs theme-text-muted mb-1">API mode (cloud execution, works behind NAT):</p>
                      <code className="block p-3 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono">
                        npx astrid-agent
                      </code>
                    </div>
                    <div>
                      <p className="text-xs theme-text-muted mb-1">Webhook mode (for servers with permanent IP):</p>
                      <code className="block p-3 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono">
                        npx astrid-agent serve --port=3001
                      </code>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium theme-text-primary mb-2">4. Update to latest version</p>
                  <code className="block p-3 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono">
                    npm install -g @gracefultools/astrid-sdk@latest
                  </code>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href="/settings/api-access">
                    Get OAuth Credentials
                  </Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href="https://www.npmjs.com/package/@gracefultools/astrid-sdk" target="_blank" rel="noreferrer">
                    <ExternalLink className="w-4 h-4 mr-1" />
                    NPM Package
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Agent Workflow Configuration */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center gap-2">
                <Server className="w-5 h-5 text-orange-500" />
                Agent Workflow Configuration
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Configure how agents create branches, PRs, and preview deployments
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm theme-text-muted">
                <p className="mb-3">
                  Control agent behavior via environment variables. No SDK update needed to change settings.
                </p>
              </div>

              {/* Git Workflow */}
              <div>
                <p className="text-sm font-medium theme-text-primary mb-2">Git Workflow</p>
                <code className="block p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono whitespace-pre-wrap">
{`# Create feature branches (default: true)
ASTRID_AGENT_CREATE_BRANCH=true

# Create pull requests (default: true)
ASTRID_AGENT_CREATE_PR=true

# Branch name prefix (default: "task/")
ASTRID_AGENT_BRANCH_PREFIX=task/

# Run tests before committing (default: true)
ASTRID_AGENT_RUN_TESTS=true
ASTRID_AGENT_TEST_COMMAND=npm run predeploy`}
                </code>
              </div>

              {/* Preview Deployments */}
              <div>
                <p className="text-sm font-medium theme-text-primary mb-2">Preview Deployments (Vercel)</p>
                <code className="block p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono whitespace-pre-wrap">
{`# Enable Vercel preview deployments (default: true)
ASTRID_AGENT_VERCEL_DEPLOY=true

# Custom domain for preview aliases (required for passkeys)
# Example: task-abc123.astrid.cc instead of random.vercel.app
ASTRID_AGENT_PREVIEW_DOMAIN=yourdomain.com

# Vercel credentials
VERCEL_TOKEN=your-vercel-token
VERCEL_PROJECT_NAME=your-project  # optional, auto-detected`}
                </code>
                <p className="text-xs theme-text-muted mt-2">
                  <strong>Note:</strong> Custom domains are required for passkeys and Google OAuth to work in previews (same-origin policy).
                </p>
              </div>

              {/* ASTRID.md */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                <p className="text-sm font-medium theme-text-primary mb-2">Project-Specific Instructions (ASTRID.md)</p>
                <p className="text-sm theme-text-muted mb-3">
                  Create an <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">ASTRID.md</code> file in your project root to give agents context about your codebase:
                </p>
                <code className="block p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono whitespace-pre-wrap">
{`# ASTRID.md - Project Instructions for AI Agents

## Project Overview
This is a Next.js 14 app with TypeScript, Prisma, and Tailwind.

## Architecture
- \`app/\` - Next.js App Router pages and API routes
- \`components/\` - React components
- \`lib/\` - Utility functions and services
- \`prisma/\` - Database schema and migrations

## Coding Standards
- Use TypeScript strict mode
- Follow existing patterns in the codebase
- Run \`npm run predeploy\` before committing

## Testing
- Unit tests: \`npm run test:run\`
- E2E tests: \`npm run test:e2e\`

## Environment Variables
See \`.env.example\` for required variables.`}
                </code>
                <p className="text-xs theme-text-muted mt-2">
                  Agents automatically read ASTRID.md (or CLAUDE.md, CODEX.md, GEMINI.md) for project context.
                </p>
              </div>

              {/* Disable Features */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-sm font-medium theme-text-primary mb-2">Disable Features</p>
                <p className="text-xs theme-text-muted mb-2">
                  Set any feature to <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">false</code> to disable:
                </p>
                <code className="block p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono whitespace-pre-wrap">
{`# Commit directly to main (no branches/PRs)
ASTRID_AGENT_CREATE_BRANCH=false
ASTRID_AGENT_CREATE_PR=false

# Skip preview deployments
ASTRID_AGENT_VERCEL_DEPLOY=false

# Skip tests
ASTRID_AGENT_RUN_TESTS=false`}
                </code>
              </div>
            </CardContent>
          </Card>

          {/* Webhook Configuration */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center gap-2">
                <Webhook className="w-5 h-5 text-indigo-500" />
                Webhook Mode Configuration
              </CardTitle>
              <CardDescription className="theme-text-muted">
                For servers with a permanent IP or domain. Get instant task notifications instead of polling.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WebhookSettingsManager />
            </CardContent>
          </Card>

          {/* GitHub Integration */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setShowGitHub(!showGitHub)}
              >
                <div>
                  <CardTitle className="theme-text-primary flex items-center gap-2">
                    <Github className="w-5 h-5" />
                    GitHub Integration
                    <span className="text-xs font-normal bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">
                      Optional
                    </span>
                  </CardTitle>
                  <CardDescription className="theme-text-muted">
                    Connect GitHub to enable automatic PR creation and code commits
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm">
                  {showGitHub ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
              </div>
            </CardHeader>
            {showGitHub && (
              <CardContent className="space-y-4 pt-0">
                <GitHubSharedSetup />
                <div className="pt-4">
                  <GitHubIntegrationSettings />
                </div>

                {/* How Coding Agents Work */}
                <div className="border-l-4 border-indigo-500 pl-4 mt-6">
                  <h3 className="font-semibold theme-text-primary mb-2">How Coding Agents Work</h3>
                  <div className="text-sm theme-text-muted space-y-2">
                    <div><strong>1. Assign Task:</strong> Agent receives the task and analyzes requirements</div>
                    <div><strong>2. AI Planning:</strong> Agent posts implementation plan for your review</div>
                    <div><strong>3. Code Generation:</strong> Agent generates code and creates a GitHub PR</div>
                    <div><strong>4. Live Preview:</strong> Vercel preview deployment is posted to the task</div>
                    <div><strong>5. Feedback:</strong> Comment on the task to request changes</div>
                    <div><strong>6. Deploy:</strong> Comment &quot;ship it&quot; to merge and deploy to production</div>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function CodingAgentsPage() {
  return (
    <Suspense fallback={<LoadingScreen message="Loading coding agents settings..." />}>
      <CodingAgentsContent />
    </Suspense>
  )
}
