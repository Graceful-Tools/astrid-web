"use client"

import { BRAND } from '@/lib/brand/config'
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Image from "next/image"
import {
  ArrowLeft,
  Bot,
  Code2,
  Cpu,
  ExternalLink,
  HelpCircle,
  Key,
  MessageSquare,
  Network,
  Shield,
  Terminal,
  Users,
} from "lucide-react"
import { enabledIntegrationMethods, WELL_KNOWN_ENDPOINTS } from "@/lib/integration-registry"
import { scrollShellClassName } from "@/components/scroll-shell"

const ICON_MAP: Record<string, React.ReactNode> = {
  Code2: <Code2 className="w-6 h-6 text-blue-500" />,
  Cpu: <Cpu className="w-6 h-6 text-cyan-500" />,
  Bot: <Bot className="w-6 h-6 text-orange-500" />,
  MessageSquare: <MessageSquare className="w-6 h-6 text-purple-500" />,
  Terminal: <Terminal className="w-6 h-6 text-green-500" />,
}

export default function IntegrationGuidePage() {
  const router = useRouter()
  const integrationMethods = enabledIntegrationMethods()
  const codingAgentMethod = integrationMethods.find(method => method.id === 'mcp')

  return (
    <div className={`${scrollShellClassName} theme-bg-primary`}>
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
            <Image src={BRAND.iconSmall} alt={BRAND.appName} width={24} height={24} className="rounded" />
            <span className="text-xl font-semibold theme-text-primary">{BRAND.wordmark}</span>
          </div>
          <div className="flex items-center space-x-1 theme-count-bg rounded-full px-3 py-1">
            <div className="w-2 h-2 theme-bg-tertiary rounded-full"></div>
            <span className="text-sm theme-text-primary">Integration Guide</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-2 sm:p-4">
        <div className="max-w-sm sm:max-w-4xl mx-auto space-y-4 sm:space-y-6">
          {/* Page Header */}
          <div className="flex items-center space-x-3">
            <Network className="w-8 h-8 text-blue-500" />
            <div>
              <h1 className="text-2xl font-bold theme-text-primary">Integration Guide</h1>
              <p className="theme-text-muted">Connect agents, tools, and services to {BRAND.appName}</p>
            </div>
          </div>

          {/* Which Integration? */}
          <Card className="theme-bg-secondary border-blue-500/30 border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <HelpCircle className="w-5 h-5 text-blue-500" />
                <span>Which integration is right for you?</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm theme-text-secondary">
              <div className="space-y-2">
                {codingAgentMethod && (
                  <p>
                    <strong className="theme-text-primary">Want your coding agent to work assigned tasks?</strong>
                    {' '}Use <strong>{codingAgentMethod.name}</strong> &mdash; your existing harness works its Ready queue.
                  </p>
                )}
                <p>
                  <strong className="theme-text-primary">Building a custom AI agent?</strong>
                  {' '}Use <strong>Custom Agents</strong> &mdash; your agent gets an @{BRAND.agentEmailDomain} identity and SSE events.
                </p>
                <p>
                  <strong className="theme-text-primary">Building a script or backend service?</strong>
                  {' '}Use the <strong>REST API</strong> &mdash; standard CRUD with OAuth2.
                </p>
                <p>
                  <strong className="theme-text-primary">Building a ChatGPT action?</strong>
                  {' '}Use <strong>ChatGPT Actions</strong> &mdash; point your GPT at the OpenAPI spec.
                </p>
                <p>
                  <strong className="theme-text-primary">Running AI coding agents?</strong>
                  {' '}Use the <strong>{BRAND.appName} SDK</strong> &mdash; npm package for terminal, API, or webhook mode.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Integration Method Cards */}
          {integrationMethods.map((method) => (
            <Card
              key={method.id}
              className="theme-bg-secondary theme-border cursor-pointer hover:scale-[1.005] transition-transform"
              onClick={() => {
                if (method.externalUrl) {
                  window.open(method.externalUrl, '_blank')
                } else if (method.docsPath) {
                  router.push(method.docsPath)
                }
              }}
            >
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {ICON_MAP[method.icon] || <Code2 className="w-6 h-6 text-gray-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold theme-text-primary">{method.name}</h3>
                      {method.externalUrl && (
                        <ExternalLink className="w-3.5 h-3.5 theme-text-muted flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-sm theme-text-muted mt-0.5">{method.tagline}</p>
                    <p className="text-sm theme-text-secondary mt-2">{method.description}</p>
                    <p className="text-xs theme-text-muted mt-2">
                      <Users className="w-3 h-3 inline mr-1" />
                      {method.audience}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Authentication Overview */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Shield className="w-5 h-5 text-green-500" />
                <span>Authentication</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                All integrations use the same OAuth2 client_credentials flow
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="theme-text-secondary">
                Create an OAuth application in{' '}
                <Button variant="link" className="p-0 h-auto text-sm" onClick={() => router.push('/settings/api-access')}>
                  Settings &rarr; API Access
                </Button>
                {' '}to get a <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">client_id</code> and{' '}
                <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">client_secret</code>.
              </p>
              <pre className="theme-bg-tertiary p-3 rounded-lg overflow-x-auto">
                <code className="text-xs font-mono theme-text-primary">
{`curl -X POST https://${BRAND.domain}/api/v1/oauth/token \\
  -H "Content-Type: application/json" \\
  -d '{
    "grant_type": "client_credentials",
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET"
  }'`}
                </code>
              </pre>
              <p className="text-xs theme-text-muted">
                Tokens expire after 1 hour. Include as{' '}
                <code className="px-1 py-0.5 theme-bg-tertiary rounded font-mono">Authorization: Bearer &lt;token&gt;</code>{' '}
                in subsequent requests.
              </p>
              <Button variant="outline" size="sm" onClick={() => router.push('/settings/api-access')}>
                Create OAuth App
              </Button>
            </CardContent>
          </Card>

          {/* Agent Identity System */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Key className="w-5 h-5 text-indigo-500" />
                <span>Agent Identity System</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                AI agents get real email identities and appear as list members
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm theme-text-secondary">
              <p>
                Every AI agent gets a <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">name@{BRAND.agentEmailDomain}</code>{' '}
                email identity. Built-in agents use provider domains (e.g.,{' '}
                <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">claude@{BRAND.agentEmailDomain}</code>), while
                Custom Agents retain the <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">.oc</code> compatibility suffix
                (e.g., <code className="px-1 py-0.5 theme-bg-tertiary rounded text-xs font-mono">buddy.oc@{BRAND.agentEmailDomain}</code>).
              </p>
              <p>
                Agents are added to lists as members, just like people. Tasks can be assigned to them,
                and their comments appear in the task thread alongside human comments.
              </p>
              <Button variant="outline" size="sm" onClick={() => router.push('/settings/agents')}>
                Register Agent
              </Button>
            </CardContent>
          </Card>

          {/* Machine-Readable Discovery */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Cpu className="w-5 h-5 text-cyan-500" />
                <span>Machine-Readable Discovery</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Well-known endpoints for automated discovery by AI tools and agents
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left theme-text-muted border-b theme-border">
                      <th className="pb-2 pr-4">URL</th>
                      <th className="pb-2">Description</th>
                    </tr>
                  </thead>
                  <tbody className="theme-text-secondary">
                    {WELL_KNOWN_ENDPOINTS.map((ep) => (
                      <tr key={ep.path} className="border-b theme-border">
                        <td className="py-2 pr-4 font-mono">
                          <code className="px-1 py-0.5 theme-bg-tertiary rounded">{ep.path}</code>
                        </td>
                        <td className="py-2">{ep.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
