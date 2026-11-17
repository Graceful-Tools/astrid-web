#!/usr/bin/env npx tsx
/**
 * `astrid-agent` from this checkout (ADEV-83): queue, claim, heartbeat and release, with
 * credentials read from `.env.local` (scripts/lib/run-astrid-agent.ts).
 *
 *   npx tsx scripts/astrid-agent.ts queue --lines --agent claude --board web …
 *   npx tsx scripts/astrid-agent.ts claim <taskId> --fixall --agent claude --list <listId>
 *
 * `npx tsx scripts/astrid-agent.ts --help` lists every flag. Exit codes are the CLI's.
 */
import { runAstridAgent } from './lib/run-astrid-agent'

runAstridAgent(process.argv.slice(2))
