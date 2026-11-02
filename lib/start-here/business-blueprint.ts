/**
 * The /starthere blueprint: one small software business run from five shared
 * lists, each worked by one agent through the queue.
 *
 * ONE source for both readers of the guide:
 * - the human page, app/[locale]/starthere/page.tsx
 * - the agent copy, app/starthere.md/route.ts (plain markdown, followable
 *   literally by Claude Code, Codex, Copilot or Muse)
 *
 * Every command in it comes from lib/agent-skill (the canonical queue skill and
 * loop-recipes), never retyped here, so the guide cannot drift from what the
 * settings recipes install. tests/lib/start-here-blueprint.test.ts pins that.
 */

import { BRAND } from '@/lib/brand/config'
import { agentEmail } from '@/lib/brand/agent-emails'
import { queueSkillAdapter, type QueueSkillHarness } from '@/lib/agent-skill/astrid-queue-skill'
import {
  ACTIONS_SECRET_NAMES,
  actionsQueueGateWorkflow,
  loopConnectCommand,
  loopScheduleCommand,
  type LoopHarness,
} from '@/lib/agent-skill/loop-recipes'

/** The public path of the guide. */
export const START_HERE_PATH = '/starthere'
/** The plain-markdown copy for agents. */
export const START_HERE_MARKDOWN_PATH = '/starthere.md'

export type StarterAgentKey = 'muse' | 'claude' | 'codex' | 'copilot' | 'github-actions'

export interface StarterList {
  /** Stable key, used by tests and the page. */
  key: 'plan' | 'build' | 'fix' | 'review' | 'automations'
  name: string
  /** Becomes the list description — which IS the agent's instructions. */
  description: string
  /** Which agent works this list. */
  agent: StarterAgentKey
}

export interface StarterAgent {
  key: StarterAgentKey
  /** Display name. */
  name: string
  /** The queue mailbox it polls as. */
  mailbox: string
  /** One line: what it is best at in this business. */
  role: string
  /** What to buy. */
  plan: string
  /** How it runs without you watching it. */
  runs: string
  /** Harness recipe used to connect it (null = GitHub Actions gate). */
  harness: LoopHarness | null
  /** The list it is scoped to. */
  list: StarterList['key']
  /** Extra one-time steps specific to this agent (plain sentences). */
  extraSteps: string[]
}

export const STARTER_LISTS: readonly StarterList[] = [
  {
    key: 'plan',
    name: 'Plan',
    agent: 'muse',
    description: `You are the planner for this business.
For each task: read it and its comments, then post a short plan or spec as a comment.
If the work needs code, create one task per change in the "Build" list (features) or the "Fix" list (bugs), each with a clear title and acceptance criteria, and link them in your comment.
Draft customer replies, release notes and roadmap updates as comments for the owner to send.
Do not change code from this list. Complete the task when your plan is posted.`,
  },
  {
    key: 'build',
    name: 'Build',
    agent: 'claude',
    description: `Build the feature this task describes in the connected repository.
Work on a new branch, add tests, open a pull request and paste its link in a comment.
Copilot reviews every pull request automatically — address its review comments before reporting done.
Never merge or deploy; the owner does that. Complete the task when the pull request is open, green and reviewed.`,
  },
  {
    key: 'fix',
    name: 'Fix',
    agent: 'codex',
    description: `Fix the bug this task describes.
First write a failing test that reproduces it, then make the smallest change that makes it pass.
Open a pull request, paste its link in a comment, and address Copilot's review comments.
Never merge or deploy. If you cannot reproduce the bug, say so in a comment and move the task to Waiting.`,
  },
  {
    key: 'review',
    name: 'Review',
    agent: 'copilot',
    description: `Review the pull request linked in this task for correctness, security, tests and readability.
Post your findings as a comment here and on the pull request. If it is ready, say so plainly.
Never merge. Complete the task when your review is posted.`,
  },
  {
    key: 'automations',
    name: 'Automations',
    agent: 'github-actions',
    description: `Recurring chores run by GitHub Actions: dependency updates, nightly test runs, weekly release notes, stale-branch cleanup.
Each task here should repeat (daily or weekly) so it re-queues itself when completed.
Report the result as a comment; open a pull request for any change; never deploy.`,
  },
]

export const STARTER_AGENTS: readonly StarterAgent[] = [
  {
    key: 'muse',
    name: 'Muse Agent',
    mailbox: 'muse',
    role: 'Plans and triages: turns ideas, feedback and bugs into clear Build and Fix tasks.',
    plan: 'A Muse account with Muse Code',
    runs: 'Muse Code connects to the MCP server and checks its queue every 30 minutes.',
    harness: 'muse',
    list: 'plan',
    extraSteps: [],
  },
  {
    key: 'claude',
    name: 'Claude',
    mailbox: 'claude',
    role: 'Builds features end to end in your repo and opens pull requests.',
    plan: 'Claude Max (Claude Code included)',
    runs: 'Claude Code connects to the MCP server and checks its queue every 30 minutes.',
    harness: 'claude-code',
    list: 'build',
    extraSteps: [],
  },
  {
    key: 'codex',
    name: 'Codex',
    mailbox: 'codex',
    role: 'Fixes bugs test-first, refactors and adds missing tests.',
    plan: 'ChatGPT Pro or Plus (Codex CLI included)',
    runs: 'Codex CLI connects to the MCP server and checks its queue every 30 minutes.',
    harness: 'codex',
    list: 'fix',
    extraSteps: [],
  },
  {
    key: 'copilot',
    name: 'GitHub Copilot',
    mailbox: 'copilot',
    role: 'Reviews every pull request on GitHub automatically, and works review tasks.',
    plan: 'GitHub Copilot Pro+ (or Business for a team)',
    runs: 'GitHub requests a Copilot review on every pull request; Copilot CLI checks the Review queue every 30 minutes.',
    harness: 'copilot',
    list: 'review',
    extraSteps: [
      'In your GitHub repository open Settings → Rules → Rulesets → New branch ruleset, target your default branch, and turn on "Automatically request Copilot code review". Every pull request any agent opens is then reviewed by Copilot without you asking.',
    ],
  },
  {
    key: 'github-actions',
    name: 'GitHub Actions',
    mailbox: 'copilot',
    role: 'Runs your recurring automations on a schedule in GitHub — nothing on your machine.',
    plan: 'Included with GitHub (free minutes on public and most private repos)',
    runs: 'A scheduled workflow asks the Automations queue for work every 30 minutes and only starts a job when there is some.',
    harness: null,
    list: 'automations',
    extraSteps: [
      `Create client credentials in ${BRAND.appName} (Settings → AI Agents → Copilot → GitHub Actions) and save them as repository secrets ${ACTIONS_SECRET_NAMES.clientId} and ${ACTIONS_SECRET_NAMES.clientSecret}.`,
    ],
  },
]

export function starterList(key: StarterList['key']): StarterList {
  const list = STARTER_LISTS.find(l => l.key === key)
  if (!list) throw new Error(`Unknown starter list ${key}`)
  return list
}

export function starterAgentForList(list: StarterList): StarterAgent {
  const agent = STARTER_AGENTS.find(a => a.key === list.agent)
  if (!agent) throw new Error(`Unknown starter agent ${list.agent}`)
  return agent
}

/** The queue-skill adapter a harness installs (path + content). */
export function starterInstall(agent: StarterAgent, listId?: string | null) {
  if (!agent.harness) return null
  const harness: QueueSkillHarness = agent.harness
  return queueSkillAdapter(harness, { mailbox: agent.mailbox, listId })
}

export interface StarterAgentSetup {
  connect: string | null
  install: { path: string; content: string } | null
  schedule: string | null
  workflow: { path: string; content: string } | null
}

/** Every copyable step for one agent, scoped to its list when the id is known. */
export function starterAgentSetup(
  agent: StarterAgent,
  origin: string,
  listId?: string | null,
): StarterAgentSetup {
  if (!agent.harness) {
    return {
      connect: null,
      install: null,
      schedule: null,
      workflow: actionsQueueGateWorkflow({ mailbox: agent.mailbox, origin, listId }),
    }
  }
  const adapter = starterInstall(agent, listId)
  return {
    connect: loopConnectCommand(agent.harness, origin),
    install: adapter ? { path: adapter.installPath, content: adapter.content } : null,
    schedule: loopScheduleCommand(agent.harness, { mailbox: agent.mailbox, origin, listId }),
    workflow: null,
  }
}

const LIST_ID_PLACEHOLDER = '<list id>'

/**
 * The whole guide as markdown, for agents (and for anyone who prefers text).
 *
 * Written so an agent can follow it top to bottom: every step says who does it
 * (the human, or you the agent), and every command is copyable as-is.
 */
export function startHereMarkdown(origin: string): string {
  const app = BRAND.appName
  const lines: string[] = []
  const push = (...l: string[]) => lines.push(...l)

  push(
    `# Run your software business with agents — from one ${app}`,
    '',
    `${app} is the shared to-do list your agents and your teammates all work from.`,
    `You drop a task in a list; the agent that owns that list picks it up, comments its plan, does the work, and reports back — in the same task, on the web or your phone.`,
    `No agent dashboards to watch: each agent checks its own queue on a schedule using the plan you already pay for.`,
    '',
    `Works for a team of 1 to 10. Human guide: ${origin}${START_HERE_PATH}`,
    '',
    '## The shape',
    '',
    '| List | Worked by | What it does |',
    '|------|-----------|--------------|',
  )
  for (const list of STARTER_LISTS) {
    const agent = starterAgentForList(list)
    push(`| ${list.name} | ${agent.name} (\`${agent.mailbox}\`) | ${agent.role} |`)
  }
  push(
    '',
    'You only need the agents you pay for. Skip a row and leave its list for yourself.',
    '',
    '## Step 1 — Create the lists (2 minutes, human)',
    '',
    `Sign in at ${origin}, open ${origin}${START_HERE_PATH} and press **Create my lists**. It creates the lists below with their instructions and makes each agent the default assignee.`,
    '',
    `By API instead (an agent with an ${app} OAuth token holding \`lists:write\`): \`POST ${origin}/api/v1/lists\` with header \`X-OAuth-Token\` and body \`{ "name", "description" }\` for each list.`,
    '',
    `A list's description is the instruction file every agent reads for tasks in that list. Copy these exactly:`,
    '',
  )
  for (const list of STARTER_LISTS) {
    push(`### ${list.name}`, '', '```text', list.description, '```', '')
  }
  push(
    '## Step 2 — Connect the agents you pay for',
    '',
    `Each agent runs as its own ${app} identity (\`<mailbox>@${BRAND.agentEmailDomain}\`) and only ever takes tasks that are **assigned to it and marked Ready**. Replace \`${LIST_ID_PLACEHOLDER}\` with the id of that agent's list (shown on ${origin}${START_HERE_PATH} after Step 1, or from \`get_lists\`).`,
    '',
  )
  for (const agent of STARTER_AGENTS) {
    const list = starterList(agent.list)
    const setup = starterAgentSetup(agent, origin, LIST_ID_PLACEHOLDER)
    push(
      `### ${agent.name} → ${list.name} list`,
      '',
      `- **Best at:** ${agent.role}`,
      `- **Buy:** ${agent.plan}`,
      `- **Runs unattended:** ${agent.runs}`,
      `- **Identity:** \`${agentEmail(agent.mailbox)}\``,
      '',
    )
    let n = 1
    if (setup.connect) {
      push(`${n++}. Connect the MCP server, then approve the ${app} sign-in it opens:`, '', '```bash', setup.connect, '```', '')
    }
    if (setup.install) {
      push(`${n++}. Install the queue skill at \`${setup.install.path}\`:`, '', '```markdown', setup.install.content, '```', '')
    }
    for (const step of agent.extraSteps) push(`${n++}. ${step}`, '')
    if (setup.schedule) {
      push(`${n++}. Run it every 30 minutes (crontab on any always-on machine):`, '', '```bash', setup.schedule, '```', '')
    }
    if (setup.workflow) {
      push(
        `${n++}. Commit \`${setup.workflow.path}\`, then replace its last step with the job that should run (for example a Copilot CLI step):`,
        '',
        '```yaml',
        setup.workflow.content,
        '```',
        '',
      )
    }
    push(
      `${n}. Check it: ask the agent to call \`get_agent_queue\` with agent "${agent.mailbox}" and listId of the ${list.name} list. \`empty: true\` means connected and idle.`,
      '',
    )
  }
  push(
    '## Step 3 — Work (every day)',
    '',
    '1. Add a task to the list whose agent should do it (it is assigned to that agent automatically).',
    '2. Set its status to **Ready** when you want the agent to start — that is the "go" button.',
    '3. The agent comments its plan, does the work, and reports back with a pull request link.',
    '4. Reply in the comments from the web or your phone. You merge and deploy.',
    '',
    'Recurring work: make the task repeat (daily, weekly) and it re-queues itself.',
    '',
    '## Step 4 — Add teammates (optional, 2–10 people)',
    '',
    `Share each list (list settings → Members → invite by email). Everyone sees the same tasks, comments and agent reports. List owners and admins can hand any task to an agent; members can hand over tasks they created. To let members hand over any task, turn on **Members can hand any task to an agent** in the list's settings → AI Agent (the agents run on the owner's plans).`,
    '',
    '## Reference',
    '',
    `- Every harness recipe, with tabs: ${origin}/docs/loops`,
    `- MCP connection and tokens: ${origin}/docs/mcp`,
    `- Agent settings (switch an agent between "My harness polls" and API mode): ${origin}/settings/agents`,
    `- Machine-readable overview: ${origin}/llms.txt`,
    '',
  )
  return lines.join('\n')
}
