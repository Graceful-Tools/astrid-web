"use client"

import { BRAND } from '@/lib/brand/config'
import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Monitor,
  Cloud,
  Server,
  Check,
  X,
  Minus,
  ChevronRight,
  Terminal,
  Smartphone,
  Globe,
  Shield,
  Zap,
  Clock,
  DollarSign,
  Settings,
  Copy,
  ExternalLink
} from "lucide-react"
import { useRouter } from "next/navigation"
import Link from "next/link"

type ExecutionMode = "local" | "cloud" | "webhook"

interface ModeConfig {
  id: ExecutionMode
  name: string
  tagline: string
  icon: React.ElementType
  color: string
  bgColor: string
  bestFor: string[]
  description: string
}

const modes: ModeConfig[] = [
  {
    id: "cloud",
    name: "Cloud API",
    tagline: "Zero setup, works anywhere",
    icon: Cloud,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    bestFor: ["Mobile users", "Quick tasks", "Non-technical users"],
    description: `${BRAND.appName} processes tasks using AI APIs. Just assign to claude@${BRAND.agentEmailDomain} and it works.`
  },
  {
    id: "local",
    name: "Local CLI",
    tagline: "Full power on your machine",
    icon: Monitor,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    bestFor: ["Developers", "Privacy-focused users", "Local projects"],
    description: `Run Claude Code CLI directly on your machine. Connect to ${BRAND.appName} tasks via MCP integration.`
  },
  {
    id: "webhook",
    name: `${BRAND.appName} SDK`,
    tagline: "Automated coding agent server",
    icon: Server,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    bestFor: ["Power users", "Teams", "24/7 availability"],
    description: `Run the ${BRAND.appName} SDK on any device. Supports polling (local) or webhook mode (servers).`
  }
]

// Trade-off matrix data
const tradeoffs = [
  {
    category: "Setup",
    icon: Settings,
    items: [
      { label: "Initial Setup", local: "medium", cloud: "easy", webhook: "easy" },
      { label: "Maintenance", local: "low", cloud: "none", webhook: "low" }
    ]
  },
  {
    category: "Capabilities",
    icon: Zap,
    items: [
      { label: "Bash/Terminal", local: "yes", cloud: "no", webhook: "yes" },
      { label: "File System Access", local: "yes", cloud: "no", webhook: "yes" },
      { label: "Git Operations", local: "yes", cloud: "limited", webhook: "yes" },
      { label: "Session Continuity", local: "yes", cloud: "no", webhook: "yes" }
    ]
  },
  {
    category: "Availability",
    icon: Clock,
    items: [
      { label: "24/7 Available", local: "no", cloud: "yes", webhook: "yes" },
      { label: "Works from Mobile", local: "no", cloud: "yes", webhook: "yes" },
      { label: "Works Behind NAT", local: "yes", cloud: "yes", webhook: "yes" }
    ]
  },
  {
    category: "Cost & Privacy",
    icon: Shield,
    items: [
      { label: "Infrastructure Cost", local: "free", cloud: "free", webhook: "free" },
      { label: "API Costs", local: "yours", cloud: "shared", webhook: "yours" },
      { label: "Data Privacy", local: "high", cloud: "medium", webhook: "high" }
    ]
  }
]

function TradeoffCell({ value }: { value: string }) {
  const configs: Record<string, { icon: React.ElementType; color: string; label: string }> = {
    yes: { icon: Check, color: "text-green-500", label: "Yes" },
    no: { icon: X, color: "text-red-400", label: "No" },
    partial: { icon: Minus, color: "text-yellow-500", label: "Partial" },
    limited: { icon: Minus, color: "text-yellow-500", label: "Limited" },
    easy: { icon: Check, color: "text-green-500", label: "Easy" },
    medium: { icon: Minus, color: "text-yellow-500", label: "Medium" },
    complex: { icon: X, color: "text-orange-400", label: "Complex" },
    none: { icon: Check, color: "text-green-500", label: "None" },
    low: { icon: Check, color: "text-green-500", label: "Low" },
    free: { icon: Check, color: "text-green-500", label: "Free" },
    vps: { icon: DollarSign, color: "text-yellow-500", label: "~$5-20/mo" },
    yours: { icon: Shield, color: "text-blue-500", label: "Your key" },
    shared: { icon: Globe, color: "text-purple-500", label: "Shared" },
    high: { icon: Shield, color: "text-green-500", label: "High" }
  }

  const config = configs[value] || { icon: Minus, color: "text-gray-400", label: value }
  const Icon = config.icon

  return (
    <div className="flex items-center gap-1.5 justify-center">
      <Icon className={`w-4 h-4 ${config.color}`} />
      <span className={`text-xs ${config.color}`}>{config.label}</span>
    </div>
  )
}

function LocalSetupGuide() {
  const [copied, setCopied] = useState(false)

  const copyCommand = async (cmd: string) => {
    await navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-4 bg-green-500/10 rounded-lg border border-green-500/20">
        <Terminal className="w-5 h-5 text-green-500 mt-0.5" />
        <div>
          <h4 className="font-medium theme-text-primary">Best for developers who want full CLI power</h4>
          <p className="text-sm theme-text-muted mt-1">
            Run Claude Code on your local machine and connect it to {BRAND.appName} tasks.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="font-semibold theme-text-primary">Setup Steps</h4>

        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-sm font-medium">1</div>
            <div className="flex-1">
              <p className="font-medium theme-text-primary">Install Claude Code CLI</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono">
                  npm install -g @anthropic-ai/claude-code
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyCommand("npm install -g @anthropic-ai/claude-code")}
                >
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-sm font-medium">2</div>
            <div className="flex-1">
              <p className="font-medium theme-text-primary">Set your Anthropic API key</p>
              <div className="mt-2">
                <code className="p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono block">
                  export ANTHROPIC_API_KEY=sk-ant-...
                </code>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-sm font-medium">3</div>
            <div className="flex-1">
              <p className="font-medium theme-text-primary">Connect to {BRAND.appName} via MCP</p>
              <p className="text-sm theme-text-muted mt-1">
                Configure the {BRAND.appName} MCP server in your Claude Code settings to sync tasks.
              </p>
              <Button variant="outline" size="sm" className="mt-2" asChild>
                <Link href="/settings/api-access" className="inline-flex items-center">
                  Configure MCP Access
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-sm font-medium">4</div>
            <div className="flex-1">
              <p className="font-medium theme-text-primary">Start working on tasks</p>
              <div className="mt-2">
                <code className="p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono block">
                  claude --mcp-server astrid
                </code>
              </div>
              <p className="text-sm theme-text-muted mt-2">
                Claude can now see your {BRAND.appName} tasks and work on them with full CLI access.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CloudSetupGuide() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-4 bg-blue-500/10 rounded-lg border border-blue-500/20">
        <Smartphone className="w-5 h-5 text-blue-500 mt-0.5" />
        <div>
          <h4 className="font-medium theme-text-primary">Best for mobile users and quick tasks</h4>
          <p className="text-sm theme-text-muted mt-1">
            Zero setup required. Just assign tasks and AI handles them automatically.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="font-semibold theme-text-primary">How It Works</h4>

        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-medium">1</div>
            <div className="flex-1">
              <p className="font-medium theme-text-primary">Create a task in {BRAND.appName}</p>
              <p className="text-sm theme-text-muted mt-1">
                Describe what you need done - writing, analysis, planning, etc.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-medium">2</div>
            <div className="flex-1">
              <p className="font-medium theme-text-primary">Assign to an AI agent</p>
              <div className="mt-2 space-y-1">
                <Badge variant="outline" className="font-mono">claude@{BRAND.agentEmailDomain}</Badge>
                <Badge variant="outline" className="font-mono ml-2">openai@{BRAND.agentEmailDomain}</Badge>
                <Badge variant="outline" className="font-mono ml-2">gemini@{BRAND.agentEmailDomain}</Badge>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-medium">3</div>
            <div className="flex-1">
              <p className="font-medium theme-text-primary">AI processes and responds</p>
              <p className="text-sm theme-text-muted mt-1">
                The AI agent analyzes your task and posts its response as a comment.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-medium">4</div>
            <div className="flex-1">
              <p className="font-medium theme-text-primary">Continue the conversation</p>
              <p className="text-sm theme-text-muted mt-1">
                Reply to comments to ask follow-up questions or request changes.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
        <h4 className="font-medium theme-text-primary flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-500" />
          Optional: Use Your Own API Keys
        </h4>
        <p className="text-sm theme-text-muted mt-1">
          For more control and higher rate limits, you can configure your own API keys.
        </p>
        <Button variant="outline" size="sm" className="mt-3" asChild>
          <Link href="/settings/agents" className="inline-flex items-center">
            Configure API Keys
            <ChevronRight className="w-4 h-4 ml-1" />
          </Link>
        </Button>
      </div>
    </div>
  )
}

function SDKSetupGuide() {
  const router = useRouter()
  const [copied, setCopied] = useState<string | null>(null)
  const [mode, setMode] = useState<"polling" | "webhook">("polling")

  const copyCommand = async (cmd: string, id: string) => {
    await navigator.clipboard.writeText(cmd)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-4 bg-purple-500/10 rounded-lg border border-purple-500/20">
        <Server className="w-5 h-5 text-purple-500 mt-0.5" />
        <div>
          <h4 className="font-medium theme-text-primary">Run coding agents on any device</h4>
          <p className="text-sm theme-text-muted mt-1">
            Install the {BRAND.appName} SDK and run AI coding agents with full tool access (file editing, bash, git).
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="outline" className="text-xs bg-purple-50 dark:bg-purple-900/30 border-purple-200 dark:border-purple-700">Claude</Badge>
            <Badge variant="outline" className="text-xs bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700">OpenAI</Badge>
            <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700">Gemini</Badge>
          </div>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="flex gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
        <button
          onClick={() => setMode("polling")}
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
            mode === "polling"
              ? "bg-white dark:bg-gray-700 shadow-sm theme-text-primary"
              : "theme-text-muted hover:theme-text-primary"
          }`}
        >
          Polling Mode
          <span className="block text-xs font-normal theme-text-muted">Local devices, laptops</span>
        </button>
        <button
          onClick={() => setMode("webhook")}
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
            mode === "webhook"
              ? "bg-white dark:bg-gray-700 shadow-sm theme-text-primary"
              : "theme-text-muted hover:theme-text-primary"
          }`}
        >
          Webhook Mode
          <span className="block text-xs font-normal theme-text-muted">Always-on servers</span>
        </button>
      </div>

      <div className="space-y-3">
        <h4 className="font-semibold theme-text-primary">Setup Steps</h4>

        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm font-medium">1</div>
            <div className="flex-1">
              <p className="font-medium theme-text-primary">Install the {BRAND.appName} SDK</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono">
                  npm install -g @gracefultools/astrid-sdk
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyCommand("npm install -g @gracefultools/astrid-sdk", "install")}
                >
                  {copied === "install" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm font-medium">2</div>
            <div className="flex-1">
              <p className="font-medium theme-text-primary">Configure environment</p>
              <div className="mt-2">
                <code className="p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono block whitespace-pre">{mode === "polling" ? `# AI Provider (at least one)
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GEMINI_API_KEY=AIza...

# ${BRAND.appName} OAuth (for polling)
ASTRID_OAUTH_CLIENT_ID=your-client-id
ASTRID_OAUTH_CLIENT_SECRET=your-secret
ASTRID_OAUTH_LIST_ID=your-list-id` : `# AI Provider (at least one)
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GEMINI_API_KEY=AIza...

# Webhook secret from ${BRAND.appName} settings
ASTRID_WEBHOOK_SECRET=your-secret`}</code>
              </div>
            </div>
          </div>

          {mode === "webhook" && (
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm font-medium">3</div>
              <div className="flex-1">
                <p className="font-medium theme-text-primary">Configure webhook URL in {BRAND.appName}</p>
                <p className="text-sm theme-text-muted mt-1">
                  Go to Settings and enter your server&apos;s webhook URL.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => router.push("/settings/webhook")}
                >
                  Configure Webhook
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm font-medium">{mode === "polling" ? "3" : "4"}</div>
            <div className="flex-1">
              <p className="font-medium theme-text-primary">Start the agent</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono">
                  {mode === "polling" ? "npx astrid-agent" : "npx astrid-agent serve --port=3001"}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyCommand(mode === "polling" ? "npx astrid-agent" : "npx astrid-agent serve --port=3001", "start")}
                >
                  {copied === "start" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              {mode === "polling" && (
                <p className="text-sm theme-text-muted mt-2">
                  Polls for tasks every 30 seconds. Works behind NAT/firewalls.
                </p>
              )}
              {mode === "webhook" && (
                <p className="text-sm theme-text-muted mt-2">
                  Use PM2 for production: <code className="text-xs">pm2 start npx -- astrid-agent serve</code>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
        <h4 className="font-medium theme-text-primary">
          {mode === "polling" ? "Why Polling Mode?" : "Why Webhook Mode?"}
        </h4>
        <div className="mt-2 text-sm theme-text-muted space-y-1">
          {mode === "polling" ? (
            <>
              <p className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Works behind NAT/firewalls</p>
              <p className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> No permanent IP required</p>
              <p className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Great for laptops and home servers</p>
              <p className="flex items-center gap-2"><Minus className="w-4 h-4 text-yellow-500" /> 30-second delay for new tasks</p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Instant task notifications</p>
              <p className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Better for production servers</p>
              <p className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Lower overhead than polling</p>
              <p className="flex items-center gap-2"><Minus className="w-4 h-4 text-yellow-500" /> Requires permanent IP/domain</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function AIExecutionModeGuide() {
  const [selectedMode, setSelectedMode] = useState<ExecutionMode>("cloud")
  const router = useRouter()

  return (
    <div className="space-y-6">
      {/* Mode Selector Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {modes.map((mode) => {
          const Icon = mode.icon
          const isSelected = selectedMode === mode.id

          return (
            <Card
              key={mode.id}
              className={`cursor-pointer transition-all ${
                isSelected
                  ? `ring-2 ring-offset-2 ${mode.color.replace("text-", "ring-")} theme-bg-secondary`
                  : "theme-bg-secondary theme-border hover:scale-[1.02]"
              }`}
              onClick={() => setSelectedMode(mode.id)}
            >
              <CardHeader className="pb-2">
                <div className={`w-10 h-10 rounded-lg ${mode.bgColor} flex items-center justify-center mb-2`}>
                  <Icon className={`w-5 h-5 ${mode.color}`} />
                </div>
                <CardTitle className="text-lg theme-text-primary">{mode.name}</CardTitle>
                <CardDescription className="theme-text-muted text-sm">
                  {mode.tagline}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1">
                  {mode.bestFor.map((item) => (
                    <Badge key={item} variant="secondary" className="text-xs">
                      {item}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Setup Guide for Selected Mode */}
      <Card className="theme-bg-secondary theme-border">
        <CardHeader>
          <CardTitle className="theme-text-primary">
            Setup: {modes.find(m => m.id === selectedMode)?.name}
          </CardTitle>
          <CardDescription className="theme-text-muted">
            {modes.find(m => m.id === selectedMode)?.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {selectedMode === "cloud" && <CloudSetupGuide />}
          {selectedMode === "local" && <LocalSetupGuide />}
          {selectedMode === "webhook" && <SDKSetupGuide />}
        </CardContent>
      </Card>

      {/* Trade-off Matrix */}
      <Card className="theme-bg-secondary theme-border">
        <CardHeader>
          <CardTitle className="theme-text-primary">Comparison Matrix</CardTitle>
          <CardDescription className="theme-text-muted">
            Compare capabilities across all three execution modes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b theme-border">
                  <th className="text-left py-3 px-2 theme-text-primary font-semibold">Feature</th>
                  <th className="text-center py-3 px-2 min-w-[100px]">
                    <div className="flex flex-col items-center gap-1">
                      <Monitor className="w-4 h-4 text-green-500" />
                      <span className="text-green-500 font-medium">Local</span>
                    </div>
                  </th>
                  <th className="text-center py-3 px-2 min-w-[100px]">
                    <div className="flex flex-col items-center gap-1">
                      <Cloud className="w-4 h-4 text-blue-500" />
                      <span className="text-blue-500 font-medium">Cloud</span>
                    </div>
                  </th>
                  <th className="text-center py-3 px-2 min-w-[100px]">
                    <div className="flex flex-col items-center gap-1">
                      <Server className="w-4 h-4 text-purple-500" />
                      <span className="text-purple-500 font-medium">SDK</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tradeoffs.map((category) => (
                  <>
                    <tr key={category.category} className="bg-gray-50 dark:bg-gray-800/50">
                      <td colSpan={4} className="py-2 px-2">
                        <div className="flex items-center gap-2 font-semibold theme-text-primary">
                          <category.icon className="w-4 h-4" />
                          {category.category}
                        </div>
                      </td>
                    </tr>
                    {category.items.map((item) => (
                      <tr key={item.label} className="border-b theme-border">
                        <td className="py-2 px-2 theme-text-muted">{item.label}</td>
                        <td className="py-2 px-2"><TradeoffCell value={item.local} /></td>
                        <td className="py-2 px-2"><TradeoffCell value={item.cloud} /></td>
                        <td className="py-2 px-2"><TradeoffCell value={item.webhook} /></td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Quick Recommendation */}
      <Card className="theme-bg-secondary border-2 border-dashed theme-border">
        <CardContent className="pt-6">
          <h3 className="font-semibold theme-text-primary mb-3">Which should I choose?</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <Monitor className="w-5 h-5 text-green-500 mt-0.5" />
              <div>
                <p className="font-medium theme-text-primary">Local CLI</p>
                <p className="theme-text-muted">You&apos;re a developer and want full control while coding</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Cloud className="w-5 h-5 text-blue-500 mt-0.5" />
              <div>
                <p className="font-medium theme-text-primary">Cloud API</p>
                <p className="theme-text-muted">You want it to &quot;just work&quot; from your phone</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Server className="w-5 h-5 text-purple-500 mt-0.5" />
              <div>
                <p className="font-medium theme-text-primary">{BRAND.appName} SDK</p>
                <p className="theme-text-muted">Run coding agents on any device with full file/git access</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
