/**
 * The coding-harness agents, defined ONCE (AWTD-937).
 *
 * A harness agent is a CLI that runs on the user's own machine — Codex, Muse —
 * rather than a provider API this server calls. Astrid dispatches nothing for
 * them: the task sits in their queue (Ready + assigned) and the user's loop
 * picks it up. See lib/ai/agent-execution-mode.ts for why that mode exists.
 *
 * WHY THIS TABLE EXISTS. Adding `codex` meant hand-editing nine lists across
 * lib/: the brand mailboxes, the local-harness set, the display profile, the
 * pollable set, the OAuth consent allowlist, the /fixall harness map, the
 * /fixall claim allowlist, the icon registry, and the webhook prefix array.
 * Every omission fails quietly and differently — miss the consent list and the
 * CLI cannot authenticate as itself; miss the harness map and `--harness muse`
 * reads as an EMPTY queue rather than an unknown harness, so the loop reports
 * "nothing to do" forever instead of erroring once.
 *
 * WHAT IS NOT HERE, deliberately. Installing and invoking a CLI is genuinely
 * per-agent — Muse is sub-command-first (`muse exec "…" --disable-approval`)
 * where Codex takes `codex exec --sandbox workspace-write "…"` — so that copy
 * lives with the settings UI that renders it. This table is the machine-
 * readable half: who exists, and what every registry needs to know about them.
 *
 * The provider-routed agents (claude@, openai@, gemini@, copilot@) stay in
 * AGENT_DEFINITIONS. They have a server executor and a credential; these do
 * not. Merging the two would be one table with two disjoint halves.
 */

export interface HarnessAgent {
  /** Mailbox and the local part of the identity address: `muse@<domain>`. */
  mailbox: string
  /** Name on the User row this identity owns, e.g. in a comment byline. */
  displayName: string
  /** Short product name for a picker or a settings tab. */
  label: string
  /**
   * The `--harness` selector `/fixall` and scripts/ready-tasks.ts accept.
   *
   * Usually the mailbox. Claude Code's is `claude-code` while its mailbox is
   * `claude`, so the two are not the same field and must not be conflated.
   */
  harnessSelector: string
  /** Brand icon, served by /api/v1/agent-icon/[slug]. */
  icon: {
    /** Slug on cdn.simpleicons.org. */
    simpleIconSlug: string
    /** Official brand hex, without the leading #. */
    brandColor: string
    /** Local fallback in /public/images/ai-agents/. */
    localFallback: string
    /** Viewport padding, as a fraction of the mark's box. */
    padding?: number
  }
}

/**
 * Every harness agent this deployment knows.
 *
 * To add one: append an entry, add its icon SVG under
 * public/images/ai-agents/, and give it a tab in
 * components/agent-runtime-settings.tsx. tests/lib/harness-agents.test.ts
 * checks that everything else follows from this.
 */
export const HARNESS_AGENTS: readonly HarnessAgent[] = [
  {
    mailbox: 'codex',
    displayName: 'Codex Agent',
    label: 'Codex',
    harnessSelector: 'codex',
    icon: { simpleIconSlug: 'openai', brandColor: '412991', localFallback: 'openai.svg' },
  },
  {
    // Meta's terminal coding agent (Muse Code, August 2026). A CLI like Codex,
    // NOT an API Astrid calls — so it is a harness agent, not a provider.
    mailbox: 'muse',
    displayName: 'Muse Agent',
    label: 'Muse',
    harnessSelector: 'muse',
    icon: { simpleIconSlug: 'meta', brandColor: '0467DF', localFallback: 'muse.svg', padding: 0.125 },
  },
] as const

/** Just the mailboxes, in table order. */
export function harnessAgentMailboxes(): string[] {
  return HARNESS_AGENTS.map((agent) => agent.mailbox)
}

/** One agent by mailbox, or null. */
export function harnessAgentByMailbox(mailbox: string | null | undefined): HarnessAgent | null {
  if (!mailbox) return null
  return HARNESS_AGENTS.find((agent) => agent.mailbox === mailbox) ?? null
}
