/**
 * The /start page's words about each agent, in the reader's language
 * (AWTD-1601). The blueprint stays the English source — app/start.md serves it
 * to agents verbatim — and the page asks the locale files first, falling back
 * to the blueprint's sentence when a key is missing.
 */
import { BRAND } from '@/lib/brand/config'
import { ACTIONS_SECRET_NAMES } from '@/lib/agent-skill/loop-recipes'
import type { StarterAgent } from './business-blueprint'

type Translate = (key: string, replacements?: Record<string, string>) => string

const KEY: Record<StarterAgent['key'], string> = {
  muse: 'muse',
  claude: 'claude',
  codex: 'codex',
  copilot: 'copilot',
  'github-actions': 'githubActions',
}

export interface StarterAgentCopy {
  role: string
  plan: string
  runs: string
  extraSteps: string[]
}

export function starterAgentCopy(agent: StarterAgent, t: Translate): StarterAgentCopy {
  const base = `startPage.agents.${KEY[agent.key]}`
  const replacements = {
    app: BRAND.appName,
    clientId: ACTIONS_SECRET_NAMES.clientId,
    clientSecret: ACTIONS_SECRET_NAMES.clientSecret,
  }
  const pick = (key: string, fallback: string) => {
    const value = t(`${base}.${key}`, replacements)
    return value && value !== `${base}.${key}` ? value : fallback
  }
  return {
    role: pick('role', agent.role),
    plan: pick('plan', agent.plan),
    runs: pick('runs', agent.runs),
    extraSteps: agent.extraSteps.map((step, index) => pick(`extraStep${index}`, step)),
  }
}
