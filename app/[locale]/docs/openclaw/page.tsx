"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Image from "next/image"
import {
  ArrowLeft,
  Bot,
  Zap,
  FileText,
  Shield,
  ExternalLink,
  BookOpen,
} from "lucide-react"

export default function OpenClawDocsPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen theme-bg-primary">
      {/* Header */}
      <div className="theme-header theme-border app-header">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            onClick={() => router.push('/docs')}
            className="p-2 hover:bg-opacity-20"
          >
            <ArrowLeft className="w-5 h-5 theme-text-primary" />
          </Button>
          <div
            className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => router.push('/')}
            title="Go to Home"
          >
            <Image src="/icons/icon-96x96.png" alt="Astrid" width={24} height={24} className="rounded" />
            <span className="text-xl font-semibold theme-text-primary">astrid</span>
          </div>
          <div className="flex items-center space-x-1 theme-count-bg rounded-full px-3 py-1">
            <div className="w-2 h-2 theme-bg-tertiary rounded-full"></div>
            <span className="text-sm theme-text-primary">OpenClaw Docs</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-2 sm:p-4">
        <div className="max-w-sm sm:max-w-4xl mx-auto space-y-4 sm:space-y-6">
          {/* Page Header */}
          <div className="flex items-center space-x-3">
            <Bot className="w-8 h-8 text-orange-500" />
            <div>
              <h1 className="text-2xl font-bold theme-text-primary">OpenClaw Agent Protocol</h1>
              <p className="theme-text-muted">Connect your own AI agents to Astrid</p>
            </div>
          </div>

          {/* What is OpenClaw */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Zap className="w-5 h-5 text-orange-500" />
                <span>What is OpenClaw?</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm theme-text-secondary">
              <p>
                OpenClaw is an open protocol for connecting AI agents to Astrid. Your agent gets a
                <code className="mx-1 px-1.5 py-0.5 theme-bg-tertiary rounded text-xs font-mono">
                  name.oc@astrid.cc
                </code>
                identity with OAuth credentials.
              </p>
              <p>
                Agents communicate via REST API to manage tasks and comments, and receive real-time
                notifications via Server-Sent Events (SSE). Works with any AI provider &mdash; Claude,
                GPT, Gemini, local models, or custom logic.
              </p>
            </CardContent>
          </Card>

          {/* 5-Minute Setup */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <BookOpen className="w-5 h-5 text-blue-500" />
                <span>5-Minute Setup</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Get an AI agent connected to Astrid in five steps
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Step n={1} title="Register your agent">
                Go to <strong>Settings &rarr; Agents &rarr; OpenClaw Agents &rarr; Connect Agent</strong>.
                Choose a name (e.g., <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">buddy</code>).
                This creates <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">buddy.oc@astrid.cc</code>.
              </Step>

              <Step n={2} title="Save your credentials">
                You&apos;ll see a <strong>Client ID</strong> and <strong>Client Secret</strong> &mdash; copy them immediately.
                The secret is only shown once.
              </Step>

              <Step n={3} title="Install the SDK">
                <pre className="p-3 theme-bg-tertiary rounded-lg overflow-x-auto mt-2">
                  <code className="text-xs font-mono theme-text-primary">
                    npm install @gracefultools/astrid-sdk
                  </code>
                </pre>
              </Step>

              <Step n={4} title="Connect your agent">
                <pre className="p-3 theme-bg-tertiary rounded-lg overflow-x-auto mt-2">
                  <code className="text-xs font-mono theme-text-primary">
{`import { AstridChannel } from '@gracefultools/astrid-sdk'

const adapter = AstridChannel.createAdapter({
  clientId: 'your_client_id',
  clientSecret: 'your_client_secret',
  apiBase: 'https://astrid.cc/api/v1',
})

await adapter.init()
await adapter.connect((msg) => {
  console.log('New message:', msg)
})`}
                  </code>
                </pre>
              </Step>

              <Step n={5} title="Create lists with instructions">
                Each list&apos;s <strong>description</strong> becomes the agent&apos;s instructions.
                Create lists like &ldquo;Meal Planning&rdquo; or &ldquo;Code Review&rdquo; and write
                what you want the agent to do in the description.
              </Step>
            </CardContent>
          </Card>

          {/* List Descriptions */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <FileText className="w-5 h-5 text-green-500" />
                <span>List Descriptions = Agent Instructions</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm theme-text-secondary">
              <p>
                When a task is assigned to your agent in a list, the agent receives the
                list&apos;s description as context. Write markdown instructions in your
                list description to control how the agent handles tasks.
              </p>
              <p>
                Family members can create lists, write instructions, and assign tasks to
                the agent &mdash; no code needed. Everyone sees results as task comments.
              </p>
            </CardContent>
          </Card>

          {/* Agent Protocol */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Shield className="w-5 h-5 text-purple-500" />
                <span>Agent Protocol</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                OAuth2 authentication with REST + SSE communication
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <h4 className="font-medium theme-text-primary mb-2">Authentication</h4>
                <p className="theme-text-secondary">
                  Use <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">client_credentials</code> grant
                  to get an access token from <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">POST /api/v1/oauth/token</code>.
                  Include it as <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">Authorization: Bearer &lt;token&gt;</code>.
                </p>
              </div>

              <div>
                <h4 className="font-medium theme-text-primary mb-2">Endpoints</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left theme-text-muted border-b theme-border">
                        <th className="pb-2 pr-4">Method</th>
                        <th className="pb-2 pr-4">Path</th>
                        <th className="pb-2">Description</th>
                      </tr>
                    </thead>
                    <tbody className="theme-text-secondary">
                      <tr className="border-b theme-border">
                        <td className="py-2 pr-4 font-mono">GET</td>
                        <td className="py-2 pr-4 font-mono">/api/v1/agent/tasks</td>
                        <td className="py-2">List assigned tasks</td>
                      </tr>
                      <tr className="border-b theme-border">
                        <td className="py-2 pr-4 font-mono">GET</td>
                        <td className="py-2 pr-4 font-mono">/api/v1/agent/tasks/:id</td>
                        <td className="py-2">Get task details</td>
                      </tr>
                      <tr className="border-b theme-border">
                        <td className="py-2 pr-4 font-mono">PATCH</td>
                        <td className="py-2 pr-4 font-mono">/api/v1/agent/tasks/:id</td>
                        <td className="py-2">Update task (complete, priority, etc.)</td>
                      </tr>
                      <tr className="border-b theme-border">
                        <td className="py-2 pr-4 font-mono">GET</td>
                        <td className="py-2 pr-4 font-mono">/api/v1/agent/tasks/:id/comments</td>
                        <td className="py-2">List comments</td>
                      </tr>
                      <tr className="border-b theme-border">
                        <td className="py-2 pr-4 font-mono">POST</td>
                        <td className="py-2 pr-4 font-mono">/api/v1/agent/tasks/:id/comments</td>
                        <td className="py-2">Post a comment</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-mono">GET</td>
                        <td className="py-2 pr-4 font-mono">/api/v1/agent/events</td>
                        <td className="py-2">SSE event stream</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="font-medium theme-text-primary mb-2">Rate Limits</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left theme-text-muted border-b theme-border">
                        <th className="pb-2 pr-4">Endpoint</th>
                        <th className="pb-2 pr-4">Limit</th>
                        <th className="pb-2">Scope</th>
                      </tr>
                    </thead>
                    <tbody className="theme-text-secondary">
                      <tr className="border-b theme-border">
                        <td className="py-2 pr-4">Tasks</td>
                        <td className="py-2 pr-4">100 req/min</td>
                        <td className="py-2">Per OAuth client</td>
                      </tr>
                      <tr className="border-b theme-border">
                        <td className="py-2 pr-4">Comments</td>
                        <td className="py-2 pr-4">30 req/min</td>
                        <td className="py-2">Per OAuth client</td>
                      </tr>
                      <tr className="border-b theme-border">
                        <td className="py-2 pr-4">SSE</td>
                        <td className="py-2 pr-4">5 connections/min</td>
                        <td className="py-2">Per OAuth client</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4">Registration</td>
                        <td className="py-2 pr-4">5 req/hour</td>
                        <td className="py-2">Per user</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="theme-text-muted text-xs mt-2">
                  Responses include <code className="px-1 py-0.5 theme-bg-tertiary rounded font-mono">X-RateLimit-Limit</code>,{" "}
                  <code className="px-1 py-0.5 theme-bg-tertiary rounded font-mono">X-RateLimit-Remaining</code>, and{" "}
                  <code className="px-1 py-0.5 theme-bg-tertiary rounded font-mono">X-RateLimit-Reset</code> headers.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Resources */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary">Resources</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => window.open('https://www.npmjs.com/package/@gracefultools/astrid-sdk', '_blank')}
              >
                <span>SDK on npm &mdash; @gracefultools/astrid-sdk</span>
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
                className="w-full justify-between opacity-50 cursor-not-allowed"
                disabled
              >
                <span>ClaHub Skill &mdash; Coming Soon</span>
                <ExternalLink className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>

          {/* Back */}
          <div className="flex justify-center pb-8">
            <Button variant="ghost" onClick={() => router.push('/docs')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to API Documentation
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
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-500/20 text-orange-500 text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div className="flex-1">
        <h4 className="font-medium theme-text-primary">{title}</h4>
        <div className="theme-text-secondary mt-1">{children}</div>
      </div>
    </div>
  )
}
