/**
 * /starthere — the guide a human OR an agent follows to run a small software
 * business with Muse, Claude, Codex, Copilot and GitHub Actions on shared lists.
 *
 * These tests play the agent: they read the markdown an agent is handed at
 * /starthere.md, pull out each agent's section, and check that following it
 * literally lands on something real — a pollable mailbox, the canonical queue
 * contract, the same command the settings recipe shows, and URLs that resolve
 * to routes that exist. The e2e spec (e2e/start-here.spec.ts) then checks the
 * live server answers those URLs the way each harness expects.
 */

import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

import { BRAND } from '@/lib/brand/config'
import { agentEmail } from '@/lib/brand/agent-emails'
import { pollableMailboxes } from '@/lib/ai/agent-execution-mode'
import { OAUTH_MCP_TOOLS } from '@/mcp/tool-definitions'
import { queueContractLine, queueSkillAdapter } from '@/lib/agent-skill/astrid-queue-skill'
import {
  actionsQueueGateWorkflow,
  claudeCodeLoopCommand,
  loopConnectCommand,
  loopScheduleCommand,
} from '@/lib/agent-skill/loop-recipes'
import {
  STARTER_AGENTS,
  STARTER_LISTS,
  START_HERE_MARKDOWN_PATH,
  START_HERE_PATH,
  starterAgentForList,
  starterAgentSetup,
  startHereMarkdown,
  starterList,
} from '@/lib/start-here/business-blueprint'

const ORIGIN = 'https://example.test'
const markdown = startHereMarkdown(ORIGIN)

/** The markdown section an agent would read for itself. */
function sectionFor(agentName: string): string {
  // Fence-aware, like a markdown reader: installed skills carry their own
  // `## ` headings inside code fences, and those must not end the section.
  const lines = markdown.split('\n')
  const start = lines.findIndex(l => l.startsWith(`### ${agentName} →`))
  expect(start, `no section for ${agentName}`).toBeGreaterThan(-1)
  let inFence = false
  let stop = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('```')) inFence = !inFence
    if (!inFence && /^#{2,3} /.test(lines[i])) { stop = i; break }
  }
  return lines.slice(start, stop).join('\n')
}

function fencedBlocks(section: string): string[] {
  return [...section.matchAll(/```[a-z]*\n([\s\S]*?)\n```/g)].map(m => m[1])
}

describe('/starthere blueprint', () => {
  it('names the five agents the guide promises', () => {
    expect(STARTER_AGENTS.map(a => a.key)).toEqual([
      'muse', 'claude', 'codex', 'copilot', 'github-actions',
    ])
  })

  it('gives every list exactly one agent, and every agent a list', () => {
    for (const list of STARTER_LISTS) {
      expect(starterAgentForList(list).list).toBe(list.key)
    }
    for (const agent of STARTER_AGENTS) {
      expect(starterList(agent.list).agent).toBe(agent.key)
    }
  })

  it('keeps the list instructions short enough to read on a phone', () => {
    for (const list of STARTER_LISTS) {
      expect(list.description.length).toBeGreaterThan(80)
      expect(list.description.length).toBeLessThan(700)
    }
  })

  it('only routes work to mailboxes the queue accepts', () => {
    // lib/agent-queue.ts refuses any mailbox outside pollableMailboxes() with
    // UnknownAgentError — a guide pointing at one would never pick up a task.
    for (const agent of STARTER_AGENTS) {
      expect(pollableMailboxes(), agent.key).toContain(agent.mailbox)
    }
  })

  it('treats Muse as the muse@ agent identity that polls over MCP, not a bare model', () => {
    const muse = STARTER_AGENTS.find(a => a.key === 'muse')!
    expect(muse.mailbox).toBe('muse')
    expect(muse.harness).toBe('muse')
    const section = sectionFor('Muse Agent')
    expect(section).toContain(agentEmail('muse'))
    expect(section).toContain(`muse mcp add ${BRAND.wordmark.toLowerCase()} --url ${ORIGIN}/mcp`)
  })
})

describe('/starthere.md, followed literally by each agent', () => {
  for (const agent of STARTER_AGENTS) {
    describe(agent.name, () => {
      const section = sectionFor(agent.name)
      const blocks = fencedBlocks(section)
      const setup = starterAgentSetup(agent, ORIGIN, '<list id>')

      it('says what to buy, what it is best at and how it runs unattended', () => {
        expect(section).toContain(agent.plan)
        expect(section).toContain(agent.role)
        expect(section).toContain(agent.runs)
      })

      if (agent.harness) {
        it('connects to this server\'s MCP endpoint with the settings recipe command', () => {
          expect(blocks).toContain(loopConnectCommand(agent.harness!, ORIGIN))
          expect(setup.connect).toContain(`${ORIGIN}/mcp`)
        })

        it('installs the canonical queue skill for its own mailbox and list', () => {
          const adapter = queueSkillAdapter(agent.harness!, { mailbox: agent.mailbox, listId: '<list id>' })
          expect(section).toContain(adapter.installPath)
          expect(blocks).toContain(adapter.content)
          expect(adapter.content).toContain(`agent "${agent.mailbox}"`)
          expect(adapter.content).toContain('listId "<list id>"')
        })

        it('schedules the loop unattended', () => {
          const schedule = loopScheduleCommand(agent.harness!, {
            mailbox: agent.mailbox, origin: ORIGIN, listId: '<list id>',
          })
          expect(blocks).toContain(schedule)
          expect(schedule).toMatch(/^\*\/30 \* \* \* \* /)
        })
      } else {
        it('ships a scheduled GitHub Actions gate scoped to its list', () => {
          const workflow = actionsQueueGateWorkflow({ mailbox: agent.mailbox, origin: ORIGIN, listId: '<list id>' })
          expect(section).toContain(workflow.path)
          expect(blocks).toContain(workflow.content)
          expect(workflow.content).toContain(`${ORIGIN}/api/v1/oauth/token`)
          expect(workflow.content).toContain(`agent=${agent.mailbox}&listId=<list id>`)
          expect(workflow.content).toContain('X-OAuth-Token')
          expect(workflow.content).toContain('cron: "*/30 * * * *"')
        })
      }

      it('ends with a non-mutating connection check on its own mailbox', () => {
        expect(section).toContain(`get_agent_queue\` with agent "${agent.mailbox}"`)
      })
    })
  }

  it('turns on automatic Copilot code review for every pull request', () => {
    expect(sectionFor('GitHub Copilot')).toMatch(/Automatically request Copilot code review/)
  })

  it('tells an agent to create each list over MCP with create_list and its agent mailbox (AWTD-1491)', () => {
    const tools = OAUTH_MCP_TOOLS.map(t => t.name)
    expect(tools).toContain('create_list')
    for (const list of STARTER_LISTS) {
      const agent = starterAgentForList(list)
      expect(markdown).toContain(`create_list { name: "${list.name}", defaultAgent: "${agent.mailbox}"`)
      // The mailbox must be one create_list can resolve: the queue accepts it.
      expect(pollableMailboxes()).toContain(agent.mailbox)
    }
  })

  it('copies every list description verbatim (they are the agent instructions)', () => {
    for (const list of STARTER_LISTS) expect(markdown).toContain(list.description)
  })

  it('only links to routes that exist in this app', () => {
    const urls = [...markdown.matchAll(new RegExp(`${ORIGIN.replace(/\./g, '\\.')}(/[A-Za-z0-9_./-]*)`, 'g'))]
      .map(m => m[1].replace(/[.,)]+$/, ''))
      .filter(p => p && p !== '/')
    expect(urls.length).toBeGreaterThan(5)
    const root = path.resolve(__dirname, '../..')
    const candidates = (p: string) => [
      path.join(root, 'app', '[locale]', p, 'page.tsx'),
      path.join(root, 'app', p, 'route.ts'),
      path.join(root, 'app', 'api', p.replace(/^\/api\//, '/').replace(/^\//, ''), 'route.ts'),
      // /mcp is a next.config rewrite to /api/mcp, served from pages/api.
      path.join(root, 'pages', 'api', `${p.replace(/^\//, '')}.ts`),
      path.join(root, 'pages', 'api', p.replace(/^\//, ''), 'index.ts'),
    ]
    for (const p of new Set(urls)) {
      const exists = candidates(p).some(c => fs.existsSync(c))
      expect(exists, `${p} has no route`).toBe(true)
    }
  })

  it('serves itself at the paths the page advertises', () => {
    expect(START_HERE_PATH).toBe('/starthere')
    expect(START_HERE_MARKDOWN_PATH).toBe('/starthere.md')
    expect(markdown).toContain(`${ORIGIN}${START_HERE_PATH}`)
  })
})

describe('loop recipe strings (moved out of AgentLoopRecipes)', () => {
  // Pinned exactly: these were inline template strings in
  // components/agent-runtime-settings.tsx, and every installed loop out there
  // was pasted from them.
  const name = BRAND.wordmark.toLowerCase()
  const line = (mailbox: string) => queueContractLine({ mailbox })

  it('keeps every connect command byte-identical', () => {
    expect(loopConnectCommand('claude-code', ORIGIN)).toBe(`claude mcp add --transport http ${name} ${ORIGIN}/mcp`)
    expect(loopConnectCommand('copilot', ORIGIN)).toBe(`copilot mcp add --transport http ${name} ${ORIGIN}/mcp`)
    expect(loopConnectCommand('codex', ORIGIN)).toBe(`codex mcp add ${name} --url ${ORIGIN}/mcp\ncodex mcp login ${name}`)
    expect(loopConnectCommand('muse', ORIGIN)).toBe(`muse mcp add ${name} --url ${ORIGIN}/mcp\nmuse mcp login ${name}`)
  })

  it('keeps every schedule line byte-identical', () => {
    const log = `>> ~/${name}-loop.log 2>&1`
    expect(loopScheduleCommand('claude-code', { mailbox: 'claude', origin: ORIGIN }))
      .toBe(`*/30 * * * * cd ~/code/your-project && claude -p "/${name}-queue" ${log}`)
    expect(loopScheduleCommand('copilot', { mailbox: 'copilot', origin: ORIGIN }))
      .toBe(`*/30 * * * * cd ~/code/your-project && copilot -p "${line('copilot')}" --allow-all-tools ${log}`)
    expect(loopScheduleCommand('codex', { mailbox: 'codex', origin: ORIGIN }))
      .toBe(`*/30 * * * * cd ~/code/your-project && codex exec --sandbox workspace-write "${line('codex')}" ${log}`)
    expect(loopScheduleCommand('muse', { mailbox: 'muse', origin: ORIGIN }))
      .toBe(`*/30 * * * * cd ~/code/your-project && muse exec "${line('muse')}" --disable-approval ${log}`)
    expect(claudeCodeLoopCommand()).toBe(`/loop 30m /${name}-queue`)
  })
})
