/**
 * Promoting an Inbox idea to Ready (ADEV-227), pure so it is testable.
 * `scripts/promote-inbox-idea.ts` is the HTTP shell.
 *
 * Two ways in (docs/FIXALL_WORKFLOW.md → *Clarifying Inbox ideas*):
 *   - an unclear note was asked one Decision and the person answered. The
 *     resume claim (`claim-fixall-task.ts resume`) has moved it Inbox → Doing,
 *     and the answer is the latest human comment after that question. An option
 *     reply (`1 — …`, the card tap) is read here. A reply in words is not
 *     guessed at: the run passes `--decided` with what it understood.
 *   - a clear note needs no question. The run passes `--decided "clear as
 *     written (agent, <date>)"`.
 *
 * Either way it is ONE write: the scope under a `**Decided:**` line, the
 * original note kept below it, `statusRole: ready` and no assignee, so the
 * next run claims and builds it.
 */

import { carriesHandbackMarker } from '@/lib/inbox-ideas'

export const PROMOTE_IDEA_USAGE =
  'Usage: npx tsx scripts/promote-inbox-idea.ts <taskId> (--scope "<markdown>" | --scope-file <path>) ' +
  '[--decided "<choice>"] --agent <mailbox>'

const VALUED_FLAGS = new Set(['--scope', '--scope-file', '--decided', '--agent'])

export interface PromoteIdeaArgs {
  taskId: string
  scope: string | undefined
  scopeFile: string | undefined
  decided: string | undefined
}

export function parsePromoteIdeaArgs(argv: string[]): PromoteIdeaArgs {
  const positional: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (VALUED_FLAGS.has(arg)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      flags[arg] = value
      i++
      continue
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option "${arg}"\n${PROMOTE_IDEA_USAGE}`)
    positional.push(arg)
  }
  if (positional.length !== 1) throw new Error(PROMOTE_IDEA_USAGE)
  if (flags['--scope'] === undefined && flags['--scope-file'] === undefined) {
    throw new Error(`--scope or --scope-file is required\n${PROMOTE_IDEA_USAGE}`)
  }
  return {
    taskId: positional[0],
    scope: flags['--scope'],
    scopeFile: flags['--scope-file'],
    decided: flags['--decided'],
  }
}

/** `- **2.** Wait` → "Wait", from the Decision comment's option list. */
function optionText(decision: string | undefined, n: number): string | null {
  if (!decision) return null
  const line = decision.split(/\r?\n/).find(row => new RegExp(`^\\s*[-*]\\s*\\*\\*${n}\\.\\*\\*\\s+`).test(row))
  if (!line) return null
  return line.replace(/^\s*[-*]\s*\*\*\d+\.\*\*\s+/, '').replace(/\s*\(recommended\)\s*$/i, '').trim() || null
}

/**
 * An option reply as a `**Decided:**` phrase, or null for a reply in words.
 * Reads the card tap (`1 — Ship today`), `1 - x`, `1. x`, a bare `1`, and the
 * old letter form (`B` is option 2), as the apps and DECISIONS.md do.
 */
export function decidedFromReply(reply: string, decision?: string): string | null {
  const match = reply.trim().match(/^(\d{1,2}|[A-Ea-e])(?:\s*[—–\-.:)]\s*(.*))?$/s)
  if (!match) return null
  const n = /\d/.test(match[1]) ? Number(match[1]) : match[1].toUpperCase().charCodeAt(0) - 64
  if (n < 1) return null
  const text = match[2]?.trim() || optionText(decision, n)
  return text ? `option ${n} — ${text}` : `option ${n}`
}

export interface PromotionComment {
  authorId?: string | null
  author?: { isAIAgent?: boolean } | null
  content: string
  createdAt?: string
}

export interface IdeaPromotionPlan {
  decided: string
  body: { description: string; statusRole: 'ready'; assigneeId: null }
}

const time = (comment: PromotionComment) => Date.parse(comment.createdAt ?? '') || 0

/** The answer to the latest agent question: the newest human comment after it. */
function answerToLatestQuestion(comments: PromotionComment[]): { reply: string; decision: string } | null {
  const authored = comments.filter(comment => comment.authorId).sort((a, b) => time(b) - time(a))
  const questionIndex = authored.findIndex(comment => comment.author?.isAIAgent && carriesHandbackMarker(comment.content))
  if (questionIndex <= 0) return null
  const reply = authored.slice(0, questionIndex).reverse().find(comment => comment.author?.isAIAgent === false)
  return reply ? { reply: reply.content, decision: authored[questionIndex].content } : null
}

export function planIdeaPromotion(input: {
  task: { description: string | null | undefined; statusRole: string | null | undefined; completed?: boolean }
  comments: PromotionComment[]
  scope: string
  decided?: string
}): IdeaPromotionPlan {
  const { task } = input
  if (task.completed) throw new Error('The task is completed; there is nothing to promote.')
  // Inbox (a clear note) or Doing (after the resume claim). Ready is already promoted; Waiting is parked.
  if (task.statusRole && task.statusRole !== 'doing') {
    throw new Error(`The task is in "${task.statusRole}"; an idea is promoted from the Inbox or Doing.`)
  }
  const scope = input.scope.trim()
  if (!scope) throw new Error('A promotion needs the scope to build.')

  let decided = input.decided?.trim()
  if (!decided) {
    const answer = answerToLatestQuestion(input.comments)
    if (!answer) throw new Error('No reply to an agent question was found; pass --decided for a clear note.')
    decided = decidedFromReply(answer.reply, answer.decision) ?? undefined
    if (!decided) {
      throw new Error('The reply is in words, not an option number: act on it, then pass --decided "<what was decided>".')
    }
  }

  const original = (task.description ?? '').trim()
  const description = [
    `**Decided:** ${decided}`,
    scope,
    ...(original ? ['---', `**Original note:**\n\n${original}`] : []),
  ].join('\n\n')
  return { decided, body: { description, statusRole: 'ready', assigneeId: null } }
}
