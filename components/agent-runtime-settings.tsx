"use client"

/**
 * The loop recipes — how each harness connects to the queue and runs it on a
 * schedule. `AgentLoopRecipes` is rendered by the agent hub (per-agent, pinned
 * to one identity), the per-list AI section (listId-scoped), and /docs/loops
 * (everything, for a logged-out reader). One copy, because a settings snippet
 * that drifts from the docs snippet is how someone pastes a config that no
 * longer matches the tool.
 *
 * The per-agent runtime toggle that used to live here became the mode control
 * in components/agent-hub.tsx.
 */

import { BRAND } from '@/lib/brand/config'
import { START_HERE_PATH } from '@/lib/start-here/business-blueprint'
import {
  queueContractLine,
  queueSkillAdapter,
  type QueueSkillHarness,
} from '@/lib/agent-skill/astrid-queue-skill'
import {
  actionsClaudeCodeWorkflow,
  actionsCopilotWorkflow,
  actionsQueueGateWorkflow,
  claudeCodeLoopCommand,
  loopConnectCommand,
  loopScheduleCommand,
  mcpServerName,
  mcpUrlFor,
  type LoopHarness,
} from '@/lib/agent-skill/loop-recipes'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ACTIONS_SECRET_NAMES, AgentCredentialsCard } from '@/components/agent-credentials-card'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'
import { RichMessage, fillMessage } from '@/components/shared/RichMessage'
import { toast } from 'sonner'

type AgentExecutionMode = 'api' | 'polling'

interface AgentRuntime {
  mailbox: string
  email: string
  mode: AgentExecutionMode
  locked: boolean
}

/** Display names live here, not in the API: the API answers with identities. */
const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  muse: 'Muse',
  copilot: 'GitHub Copilot',
  openai: 'OpenAI',
  gemini: 'Gemini',
}

/** Which harness each agent identity is usually driven by, for the setup tab. */
const DEFAULT_HARNESS: Record<string, string> = {
  claude: 'claude-code',
  codex: 'codex',
  muse: 'muse',
  copilot: 'copilot',
  openai: 'codex',
  gemini: 'gemini',
}

/**
 * The inverse, for harness-first rendering: when no agent identity is pinned,
 * each tab addresses the identity that harness normally runs as. This is what
 * lets one "connect your coding agent" card serve every harness without first
 * asking the reader which agent row they came from.
 */
const TAB_MAILBOX: Record<string, string> = {
  'claude-code': 'claude',
  copilot: 'copilot',
  codex: 'codex',
  muse: 'muse',
  github: 'copilot',
  gemini: 'gemini',
  cursor: 'claude',
}

/** Every harness tab, in display order. */
const ALL_TABS: readonly string[] = ['claude-code', 'copilot', 'codex', 'muse', 'github', 'gemini', 'cursor']

const TAB_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  copilot: 'Copilot / VS Code',
  codex: 'Codex',
  muse: 'Muse Code',
  github: 'GitHub Actions',
  gemini: 'Gemini CLI',
  cursor: 'Cursor',
}

/**
 * Which tabs a PINNED agent identity shows. A pinned row already knows what
 * runs it — offering six tabs there makes the reader pick their answer from
 * five wrong ones. Copilot keeps two because both really are its harnesses:
 * the CLI/VS Code locally, GitHub Actions in CI. Unpinned render sites (the
 * connect card, the per-list loop, /docs/loops) keep everything.
 */
const MAILBOX_TABS: Record<string, readonly string[]> = {
  claude: ['claude-code'],
  copilot: ['copilot', 'github'],
  codex: ['codex'],
  muse: ['muse'],
  openai: ['codex'],
  gemini: ['gemini'],
}

export function CopyBlock({
  code,
  label,
  testId,
}: {
  code: string
  label: string
  testId?: string
}) {
  const { t } = useTranslations()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('common.unableToCopy'))
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium theme-text-muted">{label}</span>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={copy}>
          {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="ml-1 text-xs">
            {t(copied ? 'messages.copied' : 'actions.copy')}
          </span>
        </Button>
      </div>
      <pre className="p-3 theme-bg-tertiary rounded-lg overflow-x-auto">
        <code
          className="text-xs font-mono theme-text-primary whitespace-pre-wrap break-words"
          data-testid={testId}
        >
          {code}
        </code>
      </pre>
    </div>
  )
}

/** A translated sentence split around its inline elements: the text between `{placeholders}`. */
const around = (message: string) => message.split(/\{\w+\}/)

function RecipeStep({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2 rounded-lg border theme-border p-3">
      <h4 className="text-sm font-semibold theme-text-primary">
        {number}. {title}
      </h4>
      {children}
    </section>
  )
}

/**
 * The loop recipes.
 *
 * Every primary harness follows the same four moves — connect MCP, install the
 * queue behavior, choose how it runs, and verify the complete connection — so
 * the tabs differ only in that harness's syntax.
 *
 * Exported because /docs/loops teaches the identical thing to a logged-out
 * reader. One copy: a settings panel and a docs page that drift apart is how
 * someone ends up pasting a config that no longer matches the tool.
 */
export function AgentLoopRecipes({
  mailbox,
  origin,
  listId,
}: {
  /**
   * Pin every tab to one agent identity (the per-agent runtime rows do this).
   * Omitted, each tab uses that harness's own identity via TAB_MAILBOX.
   */
  mailbox?: string
  origin: string
  /**
   * Scope the loop to one list/board. The queue endpoint takes listId so that
   * two harnesses working different boards never take each other's tasks —
   * passing it here is what makes "run a /fixall loop per list" one paste.
   */
  listId?: string | null
}) {
  const { t } = useTranslations()
  const mcpUrl = mcpUrlFor(origin)
  // Same name /docs/mcp tells people to register, so one harness ends up with one
  // server entry rather than two half-configured ones.
  const serverName = mcpServerName()
  // Connect and schedule lines come from lib/agent-skill/loop-recipes so the
  // plain-markdown /starthere.md serves the identical commands.
  const connectCmd = (harness: LoopHarness) => loopConnectCommand(harness, origin)
  const scheduleCmd = (harness: LoopHarness, tab: string) =>
    loopScheduleCommand(harness, { mailbox: agentFor(tab), origin, listId })
  const listClause = listId ? ` and listId "${listId}"` : ''
  const agentFor = (tab: string) => mailbox ?? TAB_MAILBOX[tab] ?? 'claude'
  const queueLine = (tab: string) => queueContractLine({ mailbox: agentFor(tab), listId })
  // Install steps serve the canonical queue skill's generated adapter, so a
  // recipe and the skill it installs cannot drift (lib/agent-skill).
  const adapterFor = (harness: QueueSkillHarness, tab: string) =>
    queueSkillAdapter(harness, { mailbox: agentFor(tab), listId })
  const installBlock = (harness: QueueSkillHarness, tab: string) => {
    const adapter = adapterFor(harness, tab)
    return `# ${adapter.installPath}
${adapter.content}`
  }
  const connectionCheck = (tab: string, scheduling: string) => {
    const boardSelection = listId
      ? `Use listId "${listId}" and confirm that exact board is visible.`
      : 'Choose one board from get_lists, report its name and ID, and use that listId for the queue call.'

    return `Connection check only. Do not create, comment on, update, or complete a task.
1. Confirm the ${BRAND.appName} account shown during authorization.
2. Call get_lists. ${boardSelection}
3. Confirm get_agent_queue, add_comment, and update_task are available.
4. Call get_agent_queue with agent "${agentFor(tab)}"${listClause}.
5. Report exactly:
- account: the authorized ${BRAND.appName} account
- board: selected board name and ID
- mailbox: the response agent mailbox and email
- queue visibility: empty:true, or the visible queue count
- comment/update permissions: whether both tools are available and the selected board grants write access
- scheduling: ${scheduling}
Treat empty:true as a successful connection. If a field cannot be verified, say so instead of guessing.`
  }
  const connectionTest = (tab: string, scheduling: string) => (
    <RecipeStep number={4} title={t('settingsPages.aiAgents.runtime.stepTest')}>
      <CopyBlock
        label={t('settingsPages.aiAgents.runtime.connectionCheckLabel')}
        code={connectionCheck(tab, scheduling)}
        testId="agent-connection-check"
      />
    </RecipeStep>
  )
  const gate = actionsQueueGateWorkflow({ mailbox: agentFor('github'), origin, listId })
  // The whole agent in Actions on the user's own plan (AWTD-1494, AWTD-1502).
  // /starthere holds the secrets' how-to and the token button.
  const hostedWorkflow = (tab: string, workflow: { path: string; content: string }) => (
    <div className="space-y-2">
      <p className="text-xs theme-text-muted">
        {around(t('settingsPages.aiAgents.runtime.hostedWorkflow'))[0]}
        <a className="underline" href={`${origin}${START_HERE_PATH}`}>{t('settingsPages.aiAgents.runtime.startHere')}</a>
        {around(t('settingsPages.aiAgents.runtime.hostedWorkflow'))[1]}
      </p>
      <CopyBlock
        label={t('settingsPages.aiAgents.runtime.runInActions')}
        code={`# ${workflow.path}
${workflow.content}`}
        testId={`agent-hosted-workflow-${tab}`}
      />
    </div>
  )
  const cloudSecretName =
    `COPILOT_MCP_${BRAND.wordmark.replace(/[^a-z0-9]/gi, '_').toUpperCase()}_TOKEN`
  const tokenSetupUrl = `${origin}/settings/agents`

  const visibleTabs = (mailbox && MAILBOX_TABS[mailbox]) || ALL_TABS
  const preferredTab = (mailbox && DEFAULT_HARNESS[mailbox]) || 'claude-code'

  return (
    <Tabs
      defaultValue={visibleTabs.includes(preferredTab) ? preferredTab : visibleTabs[0]}
      className="w-full"
    >
      {/* One relevant recipe needs no picker chrome. Radix unmounts inactive
          tab content, so hiding the triggers is the whole gate. */}
      {visibleTabs.length > 1 && (
        <TabsList className="flex flex-wrap h-auto">
          {visibleTabs.map(tab => (
            <TabsTrigger key={tab} value={tab}>{TAB_LABELS[tab]}</TabsTrigger>
          ))}
        </TabsList>
      )}

      <TabsContent value="claude-code" className="space-y-3 pt-3">
        <RecipeStep number={1} title={t('settingsPages.aiAgents.runtime.stepConnect')}>
          <CopyBlock
            label={t('settingsPages.aiAgents.runtime.addRemoteMcp')}
            code={connectCmd('claude-code')}
          />
          <p className="text-xs theme-text-muted">
            <RichMessage
              message={t('settingsPages.aiAgents.runtime.claudeAuthenticate')}
              values={{
                mcpCommand: <code className="font-mono">/mcp</code>,
                mcpFile: <code className="font-mono">.mcp.json</code>,
              }}
            />
          </p>
          <CopyBlock
            label={t('settingsPages.aiAgents.runtime.manualMcpFallback')}
            code={`{
  "mcpServers": {
    "${serverName}": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`}
          />
        </RecipeStep>
        <RecipeStep number={2} title={t('settingsPages.aiAgents.runtime.stepInstall')}>
          <CopyBlock
            label={t('settingsPages.aiAgents.runtime.saveSkillCommand')}
            code={installBlock('claude-code', 'claude-code')}
          />
        </RecipeStep>
        <RecipeStep number={3} title={t('settingsPages.aiAgents.runtime.stepSchedule')}>
          <CopyBlock label={t('settingsPages.aiAgents.runtime.runInSession')} code={claudeCodeLoopCommand()} />
          <CopyBlock
            label={t('settingsPages.aiAgents.runtime.cronFallback')}
            code={scheduleCmd('claude-code', 'claude-code')}
          />
          {hostedWorkflow(
            'claude-code',
            actionsClaudeCodeWorkflow({ mailbox: agentFor('claude-code'), origin, listId }),
          )}
        </RecipeStep>
        {connectionTest('claude-code', 'Claude Code /loop every 30 minutes, or the cron fallback')}
      </TabsContent>

      <TabsContent value="copilot" className="space-y-3 pt-3">
        <RecipeStep number={1} title={t('settingsPages.aiAgents.runtime.stepConnect')}>
          <CopyBlock
            label={t('settingsPages.aiAgents.runtime.copilotAddMcp')}
            code={connectCmd('copilot')}
          />
          <CopyBlock
            label={fillMessage(t('settingsPages.aiAgents.runtime.vscodeFallback'), { file: '.vscode/mcp.json' })}
            code={`{
  "servers": {
    "${serverName}": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`}
          />
          <p className="text-xs theme-text-muted">
            <RichMessage
              message={t('settingsPages.aiAgents.runtime.copilotConnectNote')}
              values={{ secretName: <code className="font-mono">{cloudSecretName}</code> }}
            />
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href={tokenSetupUrl}>
              {t('settingsPages.aiAgents.githubMcp.create')}
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </a>
          </Button>
        </RecipeStep>
        <RecipeStep number={2} title={t('settingsPages.aiAgents.runtime.stepInstall')}>
          <p className="text-xs theme-text-muted">
            {t('settingsPages.aiAgents.runtime.copilotInstall')}
          </p>
          <CopyBlock
            label={t('settingsPages.aiAgents.runtime.repoCustomAgent')}
            code={installBlock('copilot', 'copilot')}
          />
        </RecipeStep>
        <RecipeStep number={3} title={t('settingsPages.aiAgents.runtime.stepSchedule')}>
          <CopyBlock
            label={fillMessage(t('settingsPages.aiAgents.runtime.runEvery30'), { tool: 'Copilot CLI' })}
            code={scheduleCmd('copilot', 'copilot')}
          />
          <p className="text-xs theme-text-muted">
            {t('settingsPages.aiAgents.runtime.copilotInteractive')}
          </p>
          {hostedWorkflow(
            'copilot',
            actionsCopilotWorkflow({ mailbox: agentFor('copilot'), origin, listId }),
          )}
        </RecipeStep>
        {connectionTest(
          'copilot',
          'Copilot CLI cron every 30 minutes, an interactive custom-agent run, or GitHub Actions',
        )}
      </TabsContent>

      <TabsContent value="codex" className="space-y-3 pt-3">
        <RecipeStep number={1} title={t('settingsPages.aiAgents.runtime.stepConnect')}>
          <CopyBlock
            label={t('settingsPages.aiAgents.runtime.addRemoteAuthorize')}
            code={connectCmd('codex')}
          />
          <CopyBlock
            label={fillMessage(t('settingsPages.aiAgents.runtime.manualMcpFallbackFile'), { file: '~/.codex/config.toml' })}
            code={`[mcp_servers.${serverName}]
url = "${mcpUrl}"`}
          />
        </RecipeStep>
        <RecipeStep number={2} title={t('settingsPages.aiAgents.runtime.stepInstall')}>
          <CopyBlock
            label={fillMessage(t('settingsPages.aiAgents.runtime.addSkillTo'), { file: 'AGENTS.md' })}
            code={installBlock('codex', 'codex')}
          />
        </RecipeStep>
        <RecipeStep number={3} title={t('settingsPages.aiAgents.runtime.stepSchedule')}>
          <CopyBlock
            label={fillMessage(t('settingsPages.aiAgents.runtime.runEvery30'), { tool: 'Codex' })}
            code={scheduleCmd('codex', 'codex')}
          />
        </RecipeStep>
        {connectionTest('codex', 'Codex cron every 30 minutes, or a manual codex exec run')}
      </TabsContent>

      <TabsContent value="muse" className="space-y-3 pt-3">
        <RecipeStep number={1} title={t('settingsPages.aiAgents.runtime.stepConnect')}>
          <CopyBlock
            label={t('settingsPages.aiAgents.runtime.addRemoteAuthorize')}
            code={connectCmd('muse')}
          />
          <CopyBlock
            label={fillMessage(t('settingsPages.aiAgents.runtime.manualMcpFallbackFile'), { file: '~/.muse/config.toml' })}
            code={`[mcp_servers.${serverName}]
url = "${mcpUrl}"`}
          />
        </RecipeStep>
        <RecipeStep number={2} title={t('settingsPages.aiAgents.runtime.stepInstall')}>
          <CopyBlock
            label={fillMessage(t('settingsPages.aiAgents.runtime.addSkillTo'), { file: 'AGENTS.md' })}
            code={installBlock('muse', 'muse')}
          />
        </RecipeStep>
        <RecipeStep number={3} title={t('settingsPages.aiAgents.runtime.stepSchedule')}>
          <CopyBlock
            label={fillMessage(t('settingsPages.aiAgents.runtime.runEvery30'), { tool: 'Muse' })}
            code={scheduleCmd('muse', 'muse')}
          />
        </RecipeStep>
        {connectionTest('muse', 'Muse cron every 30 minutes, or a manual muse exec run')}
      </TabsContent>

      <TabsContent value="github" className="space-y-3 pt-3">
        <RecipeStep number={1} title={t('settingsPages.aiAgents.runtime.stepConnect')}>
          <p className="text-xs theme-text-muted">
            {around(t('settingsPages.aiAgents.runtime.githubConnect'))[0]}
            <code className="font-mono">{ACTIONS_SECRET_NAMES.clientId}</code>
            {around(t('settingsPages.aiAgents.runtime.githubConnect'))[1]}
            <code className="font-mono">{ACTIONS_SECRET_NAMES.clientSecret}</code>
            {around(t('settingsPages.aiAgents.runtime.githubConnect'))[2]}
          </p>
          <AgentCredentialsCard preset="githubActions" agent={agentFor('github')} />
        </RecipeStep>
        <RecipeStep number={2} title={t('settingsPages.aiAgents.runtime.stepInstall')}>
          <p className="text-xs theme-text-muted">
            {t('settingsPages.aiAgents.runtime.githubInstall')}
          </p>
          <CopyBlock
            label={t('settingsPages.aiAgents.runtime.addQueueGate')}
            testId="actions-queue-gate"
            code={`# ${gate.path}
${gate.content}`}
          />
        </RecipeStep>
        <RecipeStep number={3} title={t('settingsPages.aiAgents.runtime.stepSchedule')}>
          <p className="text-xs theme-text-muted">
            {t('settingsPages.aiAgents.runtime.githubSchedule')}
          </p>
        </RecipeStep>
        {connectionTest(
          'github',
          'GitHub Actions every 30 minutes, with workflow_dispatch for an immediate test',
        )}
      </TabsContent>

      <TabsContent value="gemini" className="space-y-3 pt-3">
        <CopyBlock
          label={fillMessage(t('settingsPages.aiAgents.runtime.addQueueToFile'), { file: '~/.gemini/settings.json' })}
          code={`{
  "mcpServers": {
    "${serverName}": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${mcpUrl}"]
    }
  }
}`}
        />
        <CopyBlock
          label={t('settingsPages.aiAgents.runtime.runLoopScheduled')}
          code={`*/30 * * * * cd ~/code/your-project && gemini -p "${queueLine('gemini')}" >> ~/${serverName}-loop.log 2>&1`}
        />
      </TabsContent>

      <TabsContent value="cursor" className="space-y-3 pt-3">
        <CopyBlock
          label={fillMessage(t('settingsPages.aiAgents.runtime.addQueueToFile'), { file: '.cursor/mcp.json' })}
          code={`{
  "mcpServers": {
    "${serverName}": {
      "url": "${mcpUrl}"
    }
  }
}`}
        />
        <p className="text-xs theme-text-muted">
          {t('settingsPages.aiAgents.runtime.cursorNoScheduler')}
        </p>
      </TabsContent>
    </Tabs>
  )
}
