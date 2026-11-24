#!/usr/bin/env npx tsx
/**
 * Promote an Inbox idea to Ready once it is clear (ADEV-227).
 *
 *   npx tsx scripts/promote-inbox-idea.ts <taskId> --scope "<markdown>" --agent claude
 *   npx tsx scripts/promote-inbox-idea.ts <taskId> --scope-file scope.md --decided "clear as written (agent, 2026-11-24)" --agent claude
 *
 * Without `--decided`, the option the person tapped is read from their reply to
 * the agent's Decision (`1 — …`). A reply in words is refused: act on the words,
 * then pass `--decided`. One PUT writes the `**Decided:**` line, the scope and the
 * original note, moves the task to Ready and clears the assignee. A read-back then
 * proves it. The rules are in scripts/lib/inbox-idea-promotion.ts, and the
 * workflow is docs/FIXALL_WORKFLOW.md → *Clarifying Inbox ideas*.
 */

import { readFileSync } from 'node:fs'
import { loadScriptEnv } from './lib/load-env'
import { agentSignature } from './lib/agent-author'
import { scriptApiOrigin, scriptClient } from './lib/script-client'
import { parsePromoteIdeaArgs, planIdeaPromotion, type PromotionComment } from './lib/inbox-idea-promotion'

loadScriptEnv()

async function main() {
  const args = parsePromoteIdeaArgs(process.argv.slice(2))
  const scope = args.scope ?? readFileSync(args.scopeFile!, 'utf8')

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('ASTRID_OAUTH_CLIENT_ID / ASTRID_OAUTH_CLIENT_SECRET missing from .env.local')
  const client = scriptClient({ clientId, clientSecret })

  const task = await client.getTask(args.taskId)
  const comments = (await client.getComments(task.id)) as PromotionComment[]
  const plan = planIdeaPromotion({ task, comments, scope, decided: args.decided })

  const token = await client.accessToken()
  const put = await fetch(`${scriptApiOrigin()}/api/v1/tasks/${encodeURIComponent(task.id)}`, {
    method: 'PUT',
    headers: { 'X-OAuth-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...plan.body, ...(await agentSignature(token)) }),
  })
  if (!put.ok) throw new Error(`Promotion failed: ${put.status} ${await put.text()}`)

  // Read back: a write that quietly did nothing would leave the idea in the Inbox.
  const after = await client.getTask(task.id)
  if (after.statusRole !== 'ready' || after.assigneeId) {
    throw new Error(`After the write the task is "${after.statusRole ?? 'Inbox'}" assigned to ${after.assigneeId ?? 'nobody'} — check it by hand.`)
  }
  if ((after.listIds?.length ?? 0) < (task.listIds?.length ?? 0)) {
    throw new Error('The task lost a board membership in the write — check it by hand.')
  }
  console.log(`✅ ${task.identifier ?? task.id} → Ready, unassigned. Decided: ${plan.decided}`)
}

main().catch(error => {
  console.error(`❌ ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
