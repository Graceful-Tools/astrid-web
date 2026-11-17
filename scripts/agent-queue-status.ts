#!/usr/bin/env npx tsx
/**
 * Is there anything for this agent to do right now? No session, no tokens.
 *
 * This is a shim (ADEV-83). The question is answered by `astrid-agent queue --lines`
 * (packages/astrid-sdk/src/queue-loop.ts), which every platform's loop shares; this
 * file keeps the old command line working for the callers that still name it — the
 * iOS loop from the web checkout, agent-run.yml, copilot-setup-steps.yml. The web loop
 * calls `scripts/astrid-agent.ts queue --lines` itself.
 *
 * WHY THE QUESTION EXISTS. A scheduled /fixall tick used to start a whole Claude
 * session just to call get_agent_queue once and find `empty: true`. GET
 * /api/v1/agent-queue is the same question for one request, so the loop asks it
 * first and pays for a session only when the answer is yes. "Yes" is two things:
 * `queue` (Ready, assigned to this agent or unassigned, due) and `attention`
 * (comments and list-chat replies nobody answered, AWTD-963).
 *
 * Usage (every flag is `astrid-agent queue`'s; see its --help):
 *   npx tsx scripts/agent-queue-status.ts --agent claude --list <listId> [--board web]
 *   … --no-write-seen          # prints KEYS: […] and writes nothing (phase one of waking)
 *   … --mark-seen --seen-keys '<json>' [--failed]   # phase two, by how the run ended
 *   … --long-run-window 22-6 --default-minutes 75 --max-tasks 1   # the RUN-* plan lines
 *
 * Exit codes: 0 there is work, 3 nothing to do, 1 could not tell (never treat as empty).
 */
import { runAstridAgent } from './lib/run-astrid-agent'

runAstridAgent(['queue', '--lines', ...process.argv.slice(2)])
