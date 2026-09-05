"use client"

/**
 * "Put your agent on a loop" — the public half of polling mode.
 *
 * The settings panel assumes you already know why you would want this. This page
 * does not: it opens with the problem (an agent that bills you twice and dies
 * quietly when a balance runs out), states the swap in one sentence, and then
 * hands over the same copy-pasteable recipes the settings panel shows, from the
 * same component.
 */

import { BRAND } from '@/lib/brand/config'
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Image from "next/image"
import {
  ArrowLeft,
  CircleDollarSign,
  Clock,
  ExternalLink,
  Repeat,
  ShieldCheck,
  Terminal,
} from "lucide-react"
import { scrollShellClassName } from "@/components/scroll-shell"
import { AgentLoopRecipes } from "@/components/agent-runtime-settings"

const HARNESS_AGENTS = [
  { mailbox: 'claude', label: 'Claude Code' },
  { mailbox: 'codex', label: 'Codex' },
  { mailbox: 'copilot', label: 'GitHub Copilot' },
  { mailbox: 'gemini', label: 'Gemini CLI' },
]

export default function AgentLoopsDocsPage() {
  const router = useRouter()
  const defaultOrigin = process.env.NEXT_PUBLIC_BASE_URL || `https://${BRAND.domain}`
  const [hostOrigin, setHostOrigin] = useState(defaultOrigin)
  const [agent, setAgent] = useState('claude')

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHostOrigin(`${window.location.protocol}//${window.location.host}`)
    }
  }, [])

  return (
    <div className={`${scrollShellClassName} theme-bg-primary`}>
      <div className="theme-header theme-border app-header">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={() => router.push('/docs')} className="p-2 hover:bg-opacity-20">
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
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Repeat className="w-8 h-8 text-green-500" />
            <h1 className="text-2xl font-bold theme-text-primary">Connect my coding agent</h1>
          </div>
          <p className="theme-text-muted">
            Assign work in {BRAND.appName}. Let the coding harness you already pay for —
            Claude Code, Codex, Copilot, Gemini — pick it up on a schedule and do it.
            No API key here, no second bill, no agent that goes quiet when a balance runs out.
          </p>
        </div>

        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary text-lg">Why not just add an API key?</CardTitle>
            <CardDescription className="theme-text-muted">
              You still can — it is one screen away, and it is the right answer when you want an
              agent that answers from your phone with nothing running at home. But if you already
              have a harness, it is the wrong one, for three reasons.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <CircleDollarSign className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium theme-text-primary">You pay twice for the same work</p>
                <p className="text-sm theme-text-muted">
                  Your Claude Code or Copilot subscription already covers coding work. Assigning that
                  same task to a server-run agent bills it again, per token, on a metered key.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium theme-text-primary">A dry balance is an invisible failure</p>
                <p className="text-sm theme-text-muted">
                  When a key runs out, every trigger returns the same error and the task fills with
                  identical failure comments. Polling has nothing to fail: the task simply waits in
                  the queue, visible on the board, until a harness picks it up.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Terminal className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium theme-text-primary">Your machine can do more than an API call</p>
                <p className="text-sm theme-text-muted">
                  A local harness has your repo, your branches, your test suite and your tools.
                  A server-side API call has a prompt.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary text-lg">How the loop works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm theme-text-muted">
            <p>
              <strong className="theme-text-primary">1.</strong> Switch an agent to
              {' '}<em>My harness polls</em> in Settings → AI Agents.
            </p>
            <p>
              <strong className="theme-text-primary">2.</strong> Assign it a task and mark that task
              {' '}<strong className="theme-text-primary">Ready</strong>. Assignment is the handshake —
              nothing is ever picked up off your board without it.
            </p>
            <p>
              <strong className="theme-text-primary">3.</strong> Your harness calls
              {' '}<code className="font-mono text-xs">get_agent_queue</code> on a schedule and works
              whatever comes back. A task with a future date waits for its date, so a repeating chore
              re-queues itself on completion and shows up when it is due.
            </p>
            <div className="flex items-start gap-2 pt-1">
              <Clock className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
              <span>
                An empty queue answers <code className="font-mono text-xs">empty: true</code>, so a
                scheduled run on a quiet day costs one HTTP request and stops.
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary text-lg">Set it up</CardTitle>
            <CardDescription className="theme-text-muted">
              Pick the agent identity your harness runs as — each one is a separate queue, so two
              harnesses never take each other&apos;s work.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {HARNESS_AGENTS.map(option => (
                <Button
                  key={option.mailbox}
                  variant={agent === option.mailbox ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAgent(option.mailbox)}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            <AgentLoopRecipes mailbox={agent} origin={hostOrigin} />
          </CardContent>
        </Card>

        <Card className="theme-bg-secondary theme-border border-blue-500/30">
          <CardHeader>
            <CardTitle className="theme-text-primary text-lg">Next</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-between border-blue-500/30"
              onClick={() => router.push('/settings/agents')}
            >
              <span>Switch an agent to polling</span>
              <ExternalLink className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              className="w-full justify-between"
              onClick={() => router.push('/docs/mcp')}
            >
              <span>MCP connection &amp; tokens</span>
              <ExternalLink className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
