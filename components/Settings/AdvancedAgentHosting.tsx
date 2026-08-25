"use client"

/**
 * The self-hosted corner of the agents page: the SDK, webhook mode, and the
 * GitHub App connection.
 *
 * Moved here from the retired Cloud Agents page (CodingAgentsSettings) when the
 * agent story consolidated onto one screen. Collapsed by default on purpose —
 * most users connect a harness over MCP and never need any of this, and an open
 * wall of env vars is what buried the simple path for a year. Content is the
 * live subset of that page: the stale OpenClaw-gateway card (it pointed at a
 * settings field that no longer exists) was deliberately not carried over.
 */

import { BRAND } from '@/lib/brand/config'
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { WebhookSettingsManager } from "@/components/webhook-settings-manager"
import { GitHubIntegrationSettings } from "@/components/github-integration-settings"
import { GitHubSharedSetup } from "@/components/github-shared-setup"
import {
  Server,
  Github,
  Webhook,
  Terminal,
  ChevronDown,
  ChevronUp,
  ExternalLink
} from "lucide-react"
import Link from "next/link"

export default function AdvancedAgentHosting() {
  const [open, setOpen] = useState(false)
  const [showGitHub, setShowGitHub] = useState(false)

  return (
    <Card className="theme-bg-secondary theme-border">
      <CardHeader>
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setOpen(!open)}
        >
          <div>
            <CardTitle className="theme-text-primary flex items-center gap-2">
              <Server className="w-5 h-5 text-indigo-500" />
              Advanced: self-hosted agents &amp; webhooks
            </CardTitle>
            <CardDescription className="theme-text-muted">
              Run the {BRAND.appName} SDK on your own server, receive webhooks instead of polling,
              and manage the GitHub App connection
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-6 pt-0">
          {/* SDK Quick Start */}
          <div className="border theme-border rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium theme-text-primary flex items-center gap-2">
              <Terminal className="w-4 h-4 text-green-500" />
              {BRAND.appName} SDK quick start
            </p>
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

# ${BRAND.appName} OAuth credentials (from API Access settings)
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
                    Uses your local Claude Code CLI. Remote control your local Claude Code from {BRAND.appName}!
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
              <p className="text-sm font-medium theme-text-primary mb-2">
                4. Tune the workflow (optional, env vars)
              </p>
              <code className="block p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono whitespace-pre-wrap">
{`# Git workflow (defaults shown)
ASTRID_AGENT_CREATE_BRANCH=true
ASTRID_AGENT_CREATE_PR=true
ASTRID_AGENT_BRANCH_PREFIX=task/
ASTRID_AGENT_RUN_TESTS=true
ASTRID_AGENT_TEST_COMMAND=npm run predeploy

# Vercel preview deployments
ASTRID_AGENT_VERCEL_DEPLOY=true
ASTRID_AGENT_PREVIEW_DOMAIN=yourdomain.com  # required for passkeys/OAuth in previews
VERCEL_TOKEN=your-vercel-token`}
              </code>
              <p className="text-xs theme-text-muted mt-2">
                Agents read <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">ASTRID.md</code>{' '}
                (or CLAUDE.md, CODEX.md, GEMINI.md) in your project root for codebase context.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings/api-access">Get OAuth Credentials</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="https://www.npmjs.com/package/@gracefultools/astrid-sdk" target="_blank" rel="noreferrer">
                  <ExternalLink className="w-4 h-4 mr-1" />
                  NPM Package
                </Link>
              </Button>
            </div>
          </div>

          {/* Webhook Configuration */}
          <div className="border theme-border rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium theme-text-primary flex items-center gap-2">
              <Webhook className="w-4 h-4 text-indigo-500" />
              Webhook mode
            </p>
            <p className="text-xs theme-text-muted">
              For servers with a permanent IP or domain: instant task notifications instead of polling.
            </p>
            <WebhookSettingsManager />
          </div>

          {/* GitHub App connection */}
          <div className="border theme-border rounded-lg p-4 space-y-3">
            <div
              className="flex items-center justify-between cursor-pointer"
              onClick={() => setShowGitHub(!showGitHub)}
            >
              <p className="text-sm font-medium theme-text-primary flex items-center gap-2">
                <Github className="w-4 h-4" />
                GitHub App connection
              </p>
              <Button variant="ghost" size="sm">
                {showGitHub ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs theme-text-muted">
              Connect GitHub so server-run agents can create branches and pull requests. Pick the
              repository per list in List Settings → Admin.
            </p>
            {showGitHub && (
              <div className="space-y-4 pt-1">
                <GitHubSharedSetup />
                <GitHubIntegrationSettings />
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
