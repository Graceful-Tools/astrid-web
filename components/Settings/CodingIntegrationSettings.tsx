"use client"

import { BRAND } from '@/lib/brand/config'
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GitHubSharedSetup } from "@/components/github-shared-setup"
import { GitHubIntegrationSettings } from "@/components/github-integration-settings"
import {
  Bot,
  CheckCircle,
  Cloud,
  Settings,
  Key,
  Copy,
  ExternalLink,
  AlertTriangle
} from "lucide-react"

interface CodingIntegrationSettingsProps {
  onNavigate: (page: string) => void
}

export default function CodingIntegrationSettings({ onNavigate }: CodingIntegrationSettingsProps) {
  const [copiedText, setCopiedText] = useState<string | null>(null)

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedText(label)
    setTimeout(() => setCopiedText(null), 2000)
  }

  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        {/* Deprecation Banner */}
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                This page is being deprecated
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                We&apos;ve consolidated AI agent setup into a simpler flow. For the best experience:
              </p>
              <ul className="text-sm text-amber-700 dark:text-amber-300 mt-2 space-y-1">
                <li>
                  <strong>For coding agents:</strong>{' '}
                  <button
                    onClick={() => onNavigate('coding-agents')}
                    className="text-amber-600 dark:text-amber-400 underline hover:no-underline"
                  >
                    Set up a Code Remote Server
                  </button>{' '}
                  (recommended for full Claude, OpenAI, and Gemini support)
                </li>
                <li>
                  <strong>For quick setup:</strong>{' '}
                  <button
                    onClick={() => onNavigate('agents')}
                    className="text-amber-600 dark:text-amber-400 underline hover:no-underline"
                  >
                    Visit AI Execution Modes
                  </button>
                </li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => onNavigate('coding-agents')}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  Go to Code Remote Setup
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate('agents')}
                  className="border-amber-400 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                >
                  View All Options
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Settings Page Header */}
        <div className="flex items-center space-x-3">
          <Bot className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold theme-text-primary">AI Coding Integration</h1>
            <p className="theme-text-muted">Connect AI assistants to your {BRAND.appName} tasks</p>
          </div>
        </div>

        {/* Workflow Comparison */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className="theme-bg-secondary theme-border">
            <CardHeader className="pb-2">
              <CardTitle className="theme-text-primary flex items-center space-x-2 text-base">
                <Settings className="w-5 h-5 text-blue-500" />
                <span>Local Workflow</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm theme-text-muted space-y-1">
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span>Run from your machine</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span>Say &quot;let&apos;s fix stuff&quot;</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span>Works with any AI client</span>
              </div>
            </CardContent>
          </Card>

          <Card className="theme-bg-secondary theme-border border-purple-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="theme-text-primary flex items-center space-x-2 text-base">
                <Cloud className="w-5 h-5 text-purple-500" />
                <span>Cloud Agents</span>
                <Badge variant="default" className="text-xs bg-purple-500">Auto</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm theme-text-muted space-y-1">
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span>Assign to your favorite coding agent</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span>Auto-creates PRs</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span>Posts progress to {BRAND.appName}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="local" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="local" className="flex items-center space-x-2">
              <Settings className="w-4 h-4" />
              <span>Local</span>
            </TabsTrigger>
            <TabsTrigger value="cloud" className="flex items-center space-x-2">
              <Cloud className="w-4 h-4" />
              <span>Cloud</span>
            </TabsTrigger>
          </TabsList>

          {/* LOCAL TAB */}
          <TabsContent value="local" className="space-y-4">
            <Card className="theme-bg-secondary theme-border">
              <CardHeader className="pb-2">
                <CardTitle className="theme-text-primary">Setup in 3 Steps</CardTitle>
                <CardDescription className="theme-text-muted">
                  Works with Claude Code, Cursor, ChatGPT, Gemini, and any AI assistant
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Step 1: OAuth */}
                <div className="border-l-4 border-blue-500 pl-4 space-y-2">
                  <h3 className="font-semibold theme-text-primary flex items-center space-x-2">
                    <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm">1</div>
                    <span>Create OAuth App</span>
                  </h3>

                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => onNavigate('api-access')}
                  >
                    <Key className="w-4 h-4 mr-2" />
                    Create OAuth App
                  </Button>

                  <div className="bg-gray-900 rounded-lg p-3 text-xs font-mono text-gray-100">
                    <div className="text-green-400"># Add to .env.local</div>
                    <div>ASTRID_OAUTH_CLIENT_ID=your_client_id</div>
                    <div>ASTRID_OAUTH_CLIENT_SECRET=your_secret</div>
                    <div>ASTRID_OAUTH_LIST_ID=your_list_uuid</div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard('ASTRID_OAUTH_CLIENT_ID=your_client_id\nASTRID_OAUTH_CLIENT_SECRET=your_secret\nASTRID_OAUTH_LIST_ID=your_list_uuid', 'env')}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    {copiedText === 'env' ? 'Copied!' : 'Copy'}
                  </Button>
                </div>

                {/* Step 2: Download */}
                <div className="border-l-4 border-purple-500 pl-4 space-y-2">
                  <h3 className="font-semibold theme-text-primary flex items-center space-x-2">
                    <div className="w-6 h-6 bg-purple-500 text-white rounded-full flex items-center justify-center text-sm">2</div>
                    <span>Download Files</span>
                  </h3>

                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      const link = document.createElement('a')
                      link.href = '/api/downloads/ASTRID_WORKFLOW.md'
                      link.download = 'ASTRID_WORKFLOW.md'
                      document.body.appendChild(link)
                      link.click()
                      document.body.removeChild(link)
                      setTimeout(() => {
                        const scriptLink = document.createElement('a')
                        scriptLink.href = '/api/downloads/get-project-tasks-oauth.ts'
                        scriptLink.download = 'get-project-tasks-oauth.ts'
                        document.body.appendChild(scriptLink)
                        scriptLink.click()
                        document.body.removeChild(scriptLink)
                      }, 500)
                    }}
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Both Files
                  </Button>

                  <div className="text-xs theme-text-muted">
                    <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">ASTRID_WORKFLOW.md</code> → project root<br/>
                    <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">get-project-tasks-oauth.ts</code> → scripts/
                  </div>
                </div>

                {/* Step 3: Configure AI */}
                <div className="border-l-4 border-green-500 pl-4 space-y-2">
                  <h3 className="font-semibold theme-text-primary flex items-center space-x-2">
                    <div className="w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center text-sm">3</div>
                    <span>Add to AI Config</span>
                  </h3>

                  <div className="bg-gray-900 rounded-lg p-3 text-xs font-mono text-gray-100">
                    <div className="text-gray-400"># Add to CLAUDE.md, .cursorrules, etc.</div>
                    <div className="text-green-400">See ASTRID_WORKFLOW.md for &quot;let&apos;s fix stuff&quot; workflow.</div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard('See ASTRID_WORKFLOW.md for "let\'s fix stuff" workflow.', 'ref')}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    {copiedText === 'ref' ? 'Copied!' : 'Copy'}
                  </Button>

                  <div className="text-xs theme-text-muted">
                    <strong>Claude Code:</strong> CLAUDE.md | <strong>Cursor:</strong> .cursorrules | <strong>Codex:</strong> CODEX.md
                  </div>
                </div>

                {/* Ready */}
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                  <h4 className="font-semibold theme-text-primary flex items-center space-x-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span>Ready!</span>
                  </h4>
                  <div className="text-sm theme-text-muted mt-1">
                    Say <strong>&quot;let&apos;s fix stuff&quot;</strong> to fetch tasks and start coding
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* CLOUD TAB */}
          <TabsContent value="cloud" className="space-y-4">
            {/* GitHub App Setup */}
            <Card className="theme-bg-secondary theme-border">
              <CardHeader className="pb-2">
                <CardTitle className="theme-text-primary">GitHub Integration</CardTitle>
                <CardDescription className="theme-text-muted">
                  Connect GitHub to let cloud agents create branches and PRs
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <GitHubSharedSetup />
                <GitHubIntegrationSettings />
              </CardContent>
            </Card>

            {/* Environment Setup */}
            <Card className="theme-bg-secondary theme-border border-purple-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="theme-text-primary flex items-center space-x-2">
                  <Cloud className="w-5 h-5 text-purple-500" />
                  <span>Cloud Worker Setup</span>
                </CardTitle>
                <CardDescription className="theme-text-muted">
                  Run a worker that polls for tasks assigned to AI agents
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Step 1: OAuth */}
                <div className="border-l-4 border-blue-500 pl-4 space-y-2">
                  <h4 className="font-medium theme-text-primary flex items-center space-x-2">
                    <div className="w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs">1</div>
                    <span>Create OAuth App</span>
                  </h4>
                  <Button variant="outline" size="sm" onClick={() => onNavigate('api-access')}>
                    <Key className="w-4 h-4 mr-2" />
                    Create OAuth App
                  </Button>
                </div>

                {/* Step 2: GitHub Token */}
                <div className="border-l-4 border-yellow-500 pl-4 space-y-2">
                  <h4 className="font-medium theme-text-primary flex items-center space-x-2">
                    <div className="w-5 h-5 bg-yellow-500 text-white rounded-full flex items-center justify-center text-xs">2</div>
                    <span>Create GitHub Token</span>
                  </h4>
                  <div className="text-xs theme-text-muted space-y-1">
                    <div>Create a fine-grained PAT with these permissions:</div>
                    <div className="bg-gray-900 rounded p-2 text-gray-100 font-mono">
                      <div>Contents: <span className="text-yellow-400">Read and write</span></div>
                      <div>Pull requests: <span className="text-yellow-400">Read and write</span></div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => window.open('https://github.com/settings/tokens?type=beta', '_blank')}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Create Token
                  </Button>
                </div>

                {/* Step 3: Environment */}
                <div className="border-l-4 border-purple-500 pl-4 space-y-2">
                  <h4 className="font-medium theme-text-primary flex items-center space-x-2">
                    <div className="w-5 h-5 bg-purple-500 text-white rounded-full flex items-center justify-center text-xs">3</div>
                    <span>Configure .env.local</span>
                  </h4>
                  <div className="bg-gray-900 rounded-lg p-3 text-xs font-mono text-gray-100 overflow-x-auto">
                    <div className="text-green-400"># Required</div>
                    <div>ASTRID_OAUTH_CLIENT_ID=astrid_client_...</div>
                    <div>ASTRID_OAUTH_CLIENT_SECRET=your_secret</div>
                    <div>ASTRID_OAUTH_LIST_ID=list-uuid</div>
                    <div>GITHUB_TOKEN=github_pat_...</div>
                    <div className="text-green-400 mt-2"># AI API Keys (add those you want)</div>
                    <div>ANTHROPIC_API_KEY=sk-ant-... <span className="text-gray-500"># claude@</span></div>
                    <div>OPENAI_API_KEY=sk-... <span className="text-gray-500"># openai-codex@</span></div>
                    <div>GEMINI_API_KEY=AIza... <span className="text-gray-500"># gemini@</span></div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(`# Required
ASTRID_OAUTH_CLIENT_ID=astrid_client_...
ASTRID_OAUTH_CLIENT_SECRET=your_secret
ASTRID_OAUTH_LIST_ID=list-uuid
GITHUB_TOKEN=github_pat_...

# AI API Keys (add those you want to use)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...`, 'cloud-env')}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    {copiedText === 'cloud-env' ? 'Copied!' : 'Copy'}
                  </Button>
                </div>

                {/* Step 4: Install & Run */}
                <div className="border-l-4 border-green-500 pl-4 space-y-2">
                  <h4 className="font-medium theme-text-primary flex items-center space-x-2">
                    <div className="w-5 h-5 bg-green-500 text-white rounded-full flex items-center justify-center text-xs">4</div>
                    <span>Install &amp; Run</span>
                  </h4>
                  <div className="bg-gray-900 rounded-lg p-3 text-xs font-mono text-gray-100">
                    <div className="text-green-400"># Install the SDK</div>
                    <div>npm install @gracefultools/astrid-sdk</div>
                    <div className="mt-2 text-green-400"># Run the worker</div>
                    <div>npx astrid-agent</div>
                    <div className="mt-2 text-green-400"># Keep it updated</div>
                    <div>npm update @gracefultools/astrid-sdk</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard('npm install @gracefultools/astrid-sdk', 'install')}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      {copiedText === 'install' ? 'Copied!' : 'Copy Install'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard('npx astrid-agent', 'worker')}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      {copiedText === 'worker' ? 'Copied!' : 'Copy Run'}
                    </Button>
                  </div>
                  <div className="text-xs theme-text-muted">
                    <a
                      href="https://www.npmjs.com/package/@gracefultools/astrid-sdk"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline"
                    >
                      View on npm →
                    </a>
                  </div>
                </div>

                {/* Usage */}
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
                  <h4 className="font-semibold theme-text-primary mb-2">Usage</h4>
                  <div className="text-sm theme-text-muted space-y-1">
                    <div>1. Create a task in {BRAND.appName}</div>
                    <div>2. Assign to an AI agent (see below)</div>
                    <div>3. Worker picks up task and creates PR</div>
                    <div>4. Review, then comment <strong>&quot;ship it&quot;</strong> to deploy</div>
                  </div>
                  <div className="mt-2 text-xs theme-text-muted border-t pt-2">
                    <strong>Comment commands:</strong> <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">approve</code> (approve plan), <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">ship it</code> (merge &amp; deploy)
                  </div>
                </div>

                {/* Available Agents */}
                <div className="border-t pt-4">
                  <h4 className="font-medium theme-text-primary mb-2">Available Agents</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className="flex items-center space-x-2 p-2 bg-purple-50 dark:bg-purple-900/20 rounded">
                      <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-white font-bold text-xs">C</div>
                      <span>claude@{BRAND.agentEmailDomain}</span>
                    </div>
                    <div className="flex items-center space-x-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                      <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-xs">O</div>
                      <span>openai@{BRAND.agentEmailDomain}</span>
                    </div>
                    <div className="flex items-center space-x-2 p-2 bg-green-50 dark:bg-green-900/20 rounded">
                      <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white font-bold text-xs">G</div>
                      <span>gemini@{BRAND.agentEmailDomain}</span>
                    </div>
                  </div>
                  <div className="text-xs theme-text-muted mt-2">
                    Worker auto-routes to the correct AI based on which agent the task is assigned to.
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Config File */}
            <Card className="theme-bg-secondary theme-border">
              <CardHeader className="pb-2">
                <CardTitle className="theme-text-primary flex items-center space-x-2">
                  <Settings className="w-5 h-5 text-green-500" />
                  <span>Customize Agent Behavior</span>
                  <Badge variant="outline" className="text-xs">Optional</Badge>
                </CardTitle>
                <CardDescription className="theme-text-muted">
                  Add a config file to your repo for project-specific agent settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs theme-text-muted">
                  Create <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">.astrid.config.json</code> in your repo root:
                </div>
                <div className="bg-gray-900 rounded-lg p-3 text-xs font-mono text-gray-100 overflow-x-auto">
                  <div>{`{`}</div>
                  <div className="pl-2">{`"version": "2.0",`}</div>
                  <div className="pl-2">{`"projectName": "My Project",`}</div>
                  <div className="pl-2">{`"validation": { "maxFilesPerPlan": 5 },`}</div>
                  <div className="pl-2">{`"safety": { "requirePlanApproval": true },`}</div>
                  <div className="pl-2 text-green-400">{`"preview": {`}</div>
                  <div className="pl-4 text-green-400">{`"waitForReady": true,`} <span className="text-gray-500">{`// wait for preview before continuing`}</span></div>
                  <div className="pl-4 text-green-400">{`"requiredForApproval": true,`} <span className="text-gray-500">{`// require preview before approval`}</span></div>
                  <div className="pl-4 text-green-400">{`"web": { "urlTemplate": "https://\${branch}.staging.myapp.com" },`}</div>
                  <div className="pl-4 text-green-400">{`"ios": { "testflightLink": "https://testflight.apple.com/join/..." }`}</div>
                  <div className="pl-2 text-green-400">{`}`}</div>
                  <div>{`}`}</div>
                </div>
                <div className="text-xs theme-text-muted space-y-1">
                  <div><strong>Approval mode:</strong> <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">requirePlanApproval</code> - review plans before implementation</div>
                  <div><strong>Preview workflow:</strong> <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">preview.waitForReady</code> - pause until preview is ready</div>
                  <div><strong>Custom templates:</strong> <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">preview.commentTemplate</code> - custom preview comment format</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('https://github.com/graceful-tools/astrid-sdk#configuration', '_blank')}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Full Config Docs
                </Button>
              </CardContent>
            </Card>

            {/* PR Preview Links */}
            <Card className="theme-bg-secondary theme-border">
              <CardHeader className="pb-2">
                <CardTitle className="theme-text-primary flex items-center space-x-2">
                  <ExternalLink className="w-5 h-5 text-blue-500" />
                  <span>PR Preview Links</span>
                </CardTitle>
                <CardDescription className="theme-text-muted">
                  Configure preview URLs posted to task comments when PRs are created
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Vercel Previews */}
                <div className="border-l-4 border-blue-500 pl-4 space-y-2">
                  <h4 className="font-medium theme-text-primary flex items-center space-x-2">
                    <span>Vercel Previews</span>
                    <Badge variant="outline" className="text-xs">Web</Badge>
                  </h4>
                  <div className="text-xs theme-text-muted">
                    Vercel auto-creates preview deployments for every PR. Add your token to fetch preview URLs:
                  </div>
                  <div className="bg-gray-900 rounded-lg p-3 text-xs font-mono text-gray-100">
                    <div className="text-green-400"># Add to .env.local</div>
                    <div>VERCEL_TOKEN=your_vercel_token</div>
                    <div>VERCEL_PROJECT_ID=prj_...</div>
                    <div>VERCEL_TEAM_ID=team_... <span className="text-gray-500"># optional</span></div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard('VERCEL_TOKEN=\nVERCEL_PROJECT_ID=', 'vercel')}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      {copiedText === 'vercel' ? 'Copied!' : 'Copy'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open('https://vercel.com/account/tokens', '_blank')}
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Create Token
                    </Button>
                  </div>
                </div>

                {/* Xcode Cloud / TestFlight */}
                <div className="border-l-4 border-purple-500 pl-4 space-y-2">
                  <h4 className="font-medium theme-text-primary flex items-center space-x-2">
                    <span>TestFlight Previews</span>
                    <Badge variant="outline" className="text-xs">iOS</Badge>
                  </h4>
                  <div className="text-xs theme-text-muted">
                    Xcode Cloud builds your iOS app on merge to main. Add TestFlight link for preview comments:
                  </div>

                  {/* Simple option */}
                  <div className="bg-gray-900 rounded-lg p-3 text-xs font-mono text-gray-100">
                    <div className="text-green-400"># Simple: Static TestFlight link</div>
                    <div>TESTFLIGHT_PUBLIC_LINK=https://testflight.apple.com/join/YOUR_CODE</div>
                  </div>

                  {/* Advanced option */}
                  <details className="text-xs">
                    <summary className="cursor-pointer theme-text-muted hover:theme-text-primary">
                      Advanced: App Store Connect API (dynamic build info)
                    </summary>
                    <div className="bg-gray-900 rounded-lg p-3 font-mono text-gray-100 mt-2">
                      <div className="text-green-400"># App Store Connect API</div>
                      <div>ASC_KEY_ID=your-key-id</div>
                      <div>ASC_ISSUER_ID=your-issuer-id</div>
                      <div>ASC_APP_ID=your-app-id</div>
                      <div>ASC_PRIVATE_KEY=&quot;-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----&quot;</div>
                    </div>
                  </details>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard('TESTFLIGHT_PUBLIC_LINK=https://testflight.apple.com/join/', 'testflight')}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      {copiedText === 'testflight' ? 'Copied!' : 'Copy'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open('https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow', '_blank')}
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Xcode Cloud Docs
                    </Button>
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-xs theme-text-muted">
                  <strong>How it works:</strong> When cloud agents create PRs, the worker fetches preview URLs and posts them as comments on your {BRAND.appName} task.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Help Link */}
        <div className="text-center py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate('help')}
            className="theme-text-muted hover:theme-text-primary"
          >
            Need help? Visit our troubleshooting guide →
          </Button>
        </div>
      </div>
    </div>
  )
}
