"use client"

import { BRAND } from '@/lib/brand/config'
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Image from "next/image"
import {
  ArrowLeft,
  BookOpen,
  Cpu,
  ExternalLink,
  Info,
  Layers,
  Shield,
  Wrench,
} from "lucide-react"
import { scrollShellClassName } from "@/components/scroll-shell"

export default function MCPDocsPage() {
  const router = useRouter()
  const defaultOrigin = process.env.NEXT_PUBLIC_BASE_URL || `https://${BRAND.domain}`
  const [hostOrigin, setHostOrigin] = useState(defaultOrigin)

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHostOrigin(`${window.location.protocol}//${window.location.host}`)
    }
  }, [])

  const mcpUrl = `${hostOrigin}/mcp`
  const copilotCliCommand = `copilot mcp add --transport http ${BRAND.wordmark} ${mcpUrl}`
  const vscodeInstallUrl = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({
    name: BRAND.wordmark,
    type: 'http',
    url: mcpUrl,
  }))}`

  return (
    <div className={`${scrollShellClassName} theme-bg-primary`}>
      {/* Header */}
      <div className="theme-header theme-border app-header">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            onClick={() => router.push('/docs/integrate')}
            className="p-2 hover:bg-opacity-20"
          >
            <ArrowLeft className="w-5 h-5 theme-text-primary" />
          </Button>
          <div
            className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => router.push('/')}
            title="Go to Home"
          >
            <Image src={BRAND.iconSmall} alt={BRAND.appName} width={24} height={24} className="rounded" />
            <span className="text-xl font-semibold theme-text-primary">{BRAND.wordmark}</span>
          </div>
          <div className="flex items-center space-x-1 theme-count-bg rounded-full px-3 py-1">
            <div className="w-2 h-2 theme-bg-tertiary rounded-full"></div>
            <span className="text-sm theme-text-primary">MCP Docs</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-2 sm:p-4">
        <div className="max-w-sm sm:max-w-4xl mx-auto space-y-4 sm:space-y-6">
          {/* Page Header */}
          <div className="flex items-center space-x-3">
            <Cpu className="w-8 h-8 text-cyan-500" />
            <div>
              <h1 className="text-2xl font-bold theme-text-primary">MCP Integration</h1>
              <p className="theme-text-muted">Model Context Protocol for AI tools</p>
            </div>
          </div>

          {/* What is MCP? */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Info className="w-5 h-5 text-cyan-500" />
                <span>What is MCP?</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm theme-text-secondary">
              <p>
                The <strong>Model Context Protocol (MCP)</strong> is an open standard that lets AI tools
                interact with external services through a unified interface. Instead of building custom
                integrations for each tool, MCP provides a single protocol that works with Claude Desktop,
                Cursor, Windsurf, and other MCP-compatible clients.
              </p>
              <p>
                {BRAND.appName}&apos;s MCP server exposes task management operations &mdash; creating tasks,
                managing lists, adding comments &mdash; as structured tools that AI assistants can call directly.
              </p>
            </CardContent>
          </Card>

          {/* GitHub Copilot */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <BookOpen className="w-5 h-5 text-blue-500" />
                <span>Connect GitHub Copilot</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                No client ID, client secret, or callback URL to configure
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              <div>
                <h3 className="font-semibold theme-text-primary">Copilot CLI</h3>
                <p className="theme-text-secondary mt-1">Run this one command:</p>
                <pre className="p-3 theme-bg-tertiary rounded-lg overflow-x-auto mt-2">
                  <code className="text-xs font-mono theme-text-primary">{copilotCliCommand}</code>
                </pre>
                <p className="theme-text-muted text-xs mt-2">
                  Using <code className="px-1 py-0.5 theme-bg-tertiary rounded font-mono">/mcp add</code>?
                  Set name to <strong>{BRAND.wordmark}</strong>, type to <strong>HTTP</strong>, URL to{' '}
                  <code className="px-1 py-0.5 theme-bg-tertiary rounded font-mono">{mcpUrl}</code>,
                  leave headers empty, and keep tools set to <strong>*</strong>.
                </p>
              </div>

              <div className="border-t theme-border pt-5">
                <h3 className="font-semibold theme-text-primary">VS Code Copilot Chat</h3>
                <p className="theme-text-secondary mt-1 mb-3">
                  Install the same hosted server directly in VS Code:
                </p>
                <Button asChild>
                  <a href={vscodeInstallUrl}>Install in VS Code</a>
                </Button>
                <p className="theme-text-muted text-xs mt-3">
                  Or run <strong>MCP: Add Server</strong>, choose <strong>HTTP</strong>, and paste{' '}
                  <code className="px-1 py-0.5 theme-bg-tertiary rounded font-mono">{mcpUrl}</code>.
                </p>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                <p className="theme-text-secondary">
                  <strong className="theme-text-primary">Then sign in.</strong> Copilot discovers
                  {' '}{BRAND.appName}&apos;s OAuth settings, registers itself, and opens your browser.
                  Approve access and start asking Copilot about your tasks.
                </p>
                <p className="theme-text-muted text-xs mt-2">
                  Do not create an OAuth app or enter a callback URL. Copilot supplies its temporary
                  local callback automatically, and {BRAND.appName} validates it with PKCE.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Manual setup */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <BookOpen className="w-5 h-5 text-blue-500" />
                <span>Manual setup for older clients</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Only use this when your client cannot perform OAuth discovery
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Step n={1} title="Create OAuth credentials">
                Go to{' '}
                <Button variant="link" className="p-0 h-auto text-sm" onClick={() => router.push('/settings/api-access')}>
                  Settings &rarr; API Access
                </Button>
                {' '}and create a new OAuth application. Copy the <strong>Client ID</strong> and <strong>Client Secret</strong>.
              </Step>

              <Step n={2} title="Get an MCP access token">
                <pre className="p-3 theme-bg-tertiary rounded-lg overflow-x-auto mt-2">
                  <code className="text-xs font-mono theme-text-primary">
{`curl -X POST ${hostOrigin}/api/v1/oauth/token \\
  -H "Content-Type: application/json" \\
  -d '{
    "grant_type": "client_credentials",
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET"
  }'`}
                  </code>
                </pre>
                <p className="theme-text-muted text-xs mt-2">
                  Save the <code className="px-1 py-0.5 theme-bg-tertiary rounded font-mono">access_token</code> from the response.
                </p>
              </Step>

              <Step n={3} title="Configure your AI tool">
                <p className="mb-2">
                  <strong>Option A: Remote MCP (Recommended)</strong> &mdash; Use the hosted MCP server URL directly.
                  Paste into Claude Desktop, Cursor, or Windsurf&apos;s MCP settings:
                </p>
                <pre className="p-3 theme-bg-tertiary rounded-lg overflow-x-auto mt-2">
                  <code className="text-xs font-mono theme-text-primary">
{`{
  "mcpServers": {
    "astrid": {
      "url": "${hostOrigin}/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ACCESS_TOKEN"
      }
    }
  }
}`}
                  </code>
                </pre>
                <p className="mb-2 mt-4">
                  <strong>Option B: POST Endpoint</strong> &mdash; For clients that need the POST URL:
                </p>
                <pre className="p-3 theme-bg-tertiary rounded-lg overflow-x-auto mt-2">
                  <code className="text-xs font-mono theme-text-primary">
{`POST ${hostOrigin}/mcp/messages
Authorization: Bearer YOUR_ACCESS_TOKEN`}
                  </code>
                </pre>
              </Step>

              <Step n={4} title="Test the connection">
                Ask your AI tool to &ldquo;list my {BRAND.appName} task lists&rdquo; or &ldquo;show my tasks&rdquo;.
                You can also test operations in{' '}
                <Button variant="link" className="p-0 h-auto text-sm" onClick={() => router.push('/settings/api-testing')}>
                  Settings &rarr; API Testing
                </Button>.
              </Step>

              <Step n={5} title="Put it on a loop (optional)">
                Connected by hand, this answers questions. On a schedule, it works your queue:
                the harness asks <code className="px-1 py-0.5 theme-bg-tertiary rounded font-mono text-xs">get_agent_queue</code>{' '}
                every half hour and does whatever you assigned it.{' '}
                <Button variant="link" className="p-0 h-auto text-sm" onClick={() => router.push('/docs/loops')}>
                  Run your agent on a loop
                </Button>.
              </Step>
            </CardContent>
          </Card>

          {/* Available Operations */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Layers className="w-5 h-5 text-purple-500" />
                <span>Available Operations</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                All operations are called via POST to <code className="px-1 py-0.5 theme-bg-tertiary rounded font-mono text-xs">/api/mcp/operations</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Tasks */}
              <OperationGroup
                title="Tasks"
                operations={[
                  { name: 'getListTasks', description: 'Get all tasks from a specific list' },
                  { name: 'getUserTasks', description: 'Get tasks assigned to the authenticated user' },
                  { name: 'createTask', description: 'Create a new task in a list' },
                  { name: 'updateTask', description: 'Update task properties (title, completed, priority)' },
                  { name: 'deleteTask', description: 'Delete a task' },
                  { name: 'getTaskDetails', description: 'Get full task details with comments and metadata' },
                  { name: 'addTaskAttachment', description: 'Add an attachment to a task' },
                ]}
              />

              {/* Lists */}
              <OperationGroup
                title="Lists"
                operations={[
                  { name: 'getSharedLists', description: 'Get all lists accessible to the user' },
                  { name: 'getPublicLists', description: 'Browse publicly shared lists' },
                  { name: 'copyPublicList', description: 'Copy a public list to your account' },
                  { name: 'createList', description: 'Create a new task list' },
                  { name: 'updateList', description: 'Update list name, description, or settings' },
                  { name: 'deleteList', description: 'Delete a list and its tasks' },
                ]}
              />

              {/* Comments */}
              <OperationGroup
                title="Comments"
                operations={[
                  { name: 'addComment', description: 'Add a comment to a task' },
                  { name: 'getTaskComments', description: 'Get all comments for a task' },
                  { name: 'deleteComment', description: 'Delete a comment' },
                ]}
              />

              {/* Members */}
              <OperationGroup
                title="Members"
                operations={[
                  { name: 'getListMembers', description: 'Get all members of a list' },
                  { name: 'addListMember', description: 'Add a member to a list' },
                  { name: 'updateListMember', description: 'Update member role or permissions' },
                  { name: 'removeListMember', description: 'Remove a member from a list' },
                ]}
              />

              {/* GitHub */}
              <OperationGroup
                title="GitHub"
                operations={[
                  { name: 'getGitHubUserForRepository', description: 'Get GitHub user for a repo' },
                  { name: 'getRepositoryFile', description: 'Read a file from a repository' },
                  { name: 'listRepositoryFiles', description: 'List files in a repository' },
                  { name: 'createBranch', description: 'Create a new branch' },
                  { name: 'commitChanges', description: 'Commit file changes' },
                  { name: 'createPullRequest', description: 'Create a pull request' },
                  { name: 'mergePullRequest', description: 'Merge a pull request' },
                  { name: 'addPullRequestComment', description: 'Comment on a pull request' },
                  { name: 'getPullRequestComments', description: 'Get PR comments' },
                  { name: 'getRepositoryInfo', description: 'Get repository metadata' },
                ]}
              />

              {/* Deployments */}
              <OperationGroup
                title="Deployments"
                operations={[
                  { name: 'deployToStaging', description: 'Deploy to staging environment' },
                  { name: 'getDeploymentStatus', description: 'Check deployment status' },
                  { name: 'getDeploymentLogs', description: 'Get deployment logs' },
                  { name: 'getDeploymentErrors', description: 'Get deployment errors' },
                  { name: 'listDeployments', description: 'List recent deployments' },
                ]}
              />

              {/* Settings */}
              <OperationGroup
                title="Settings"
                operations={[
                  { name: 'getUserSettings', description: 'Get user preferences' },
                  { name: 'updateUserSettings', description: 'Update user preferences' },
                ]}
              />
            </CardContent>
          </Card>

          {/* How It Works */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Wrench className="w-5 h-5 text-orange-500" />
                <span>How It Works</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                MCP operations use a single POST endpoint with operation routing
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="theme-text-secondary">
                All MCP operations go through a single endpoint. The <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">operation</code>{' '}
                field determines which handler runs, and <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">args</code>{' '}
                contains the parameters.
              </p>
              <pre className="theme-bg-tertiary p-3 rounded-lg overflow-x-auto">
                <code className="text-xs font-mono theme-text-primary">
{`POST ${hostOrigin}/api/mcp/operations
Content-Type: application/json

{
  "operation": "get_shared_lists",
  "args": {
    "accessToken": "YOUR_ACCESS_TOKEN"
  }
}`}
                </code>
              </pre>
              <pre className="theme-bg-tertiary p-3 rounded-lg overflow-x-auto">
                <code className="text-xs font-mono theme-text-primary">
{`POST ${hostOrigin}/api/mcp/operations
Content-Type: application/json

{
  "operation": "create_task",
  "args": {
    "accessToken": "YOUR_ACCESS_TOKEN",
    "listId": "list-uuid",
    "title": "Buy groceries",
    "description": "Milk, eggs, bread"
  }
}`}
                </code>
              </pre>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                <div className="flex items-start space-x-2">
                  <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs theme-text-muted">
                    <strong className="theme-text-primary">Note:</strong> Operation names use <code className="px-1 py-0.5 theme-bg-tertiary rounded font-mono">snake_case</code>{' '}
                    in the API (e.g., <code className="px-1 py-0.5 theme-bg-tertiary rounded font-mono">get_shared_lists</code>).
                    The access token is passed as an arg, not in the Authorization header.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Resources */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Shield className="w-5 h-5 text-green-500" />
                <span>Resources</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => window.open('https://modelcontextprotocol.io', '_blank')}
              >
                <span>Model Context Protocol Specification</span>
                <ExternalLink className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => window.open('https://www.npmjs.com/package/@gracefultools/astrid-sdk', '_blank')}
              >
                <span>{BRAND.appName} SDK on npm</span>
                <ExternalLink className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => router.push('/docs/endpoints')}
              >
                <span>Full API Endpoints Reference</span>
                <ExternalLink className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => router.push('/settings/api-access')}
              >
                <span>Get MCP Token</span>
                <ExternalLink className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => router.push('/settings/api-testing')}
              >
                <span>Test Operations</span>
                <ExternalLink className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>

          {/* Back */}
          <div className="flex justify-center pb-8">
            <Button variant="ghost" onClick={() => router.push('/docs/integrate')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Integration Guide
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-500 text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div className="flex-1">
        <h4 className="font-medium theme-text-primary">{title}</h4>
        <div className="theme-text-secondary mt-1">{children}</div>
      </div>
    </div>
  )
}

function OperationGroup({ title, operations }: { title: string; operations: { name: string; description: string }[] }) {
  return (
    <div>
      <h4 className="font-medium theme-text-primary mb-2 text-sm">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left theme-text-muted border-b theme-border">
              <th className="pb-2 pr-4">Operation</th>
              <th className="pb-2">Description</th>
            </tr>
          </thead>
          <tbody className="theme-text-secondary">
            {operations.map((op) => (
              <tr key={op.name} className="border-b theme-border">
                <td className="py-1.5 pr-4 font-mono">
                  <code className="px-1 py-0.5 theme-bg-tertiary rounded">{op.name}</code>
                </td>
                <td className="py-1.5">{op.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
