// Reads the canonical agent mailbox and coding-harness registries without retyping them.
// Invoked by scripts/export-contract-fixtures.ts.
//
// Usage: node scripts/contract-fixtures/drivers/agent-registry.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/agent-registry.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const load = (rel) => import(pathToFileURL(join(webRoot, rel)).href)
const [{ AGENT_MAILBOXES }, { HARNESS_AGENTS, pollingOnlyHarnessMailboxes }] = await Promise.all([
  load('lib/brand/agent-emails.ts'),
  load('lib/ai/harness-agents.ts'),
])

console.log(JSON.stringify({
  $source: 'scripts/contract-fixtures/drivers/agent-registry.mjs — lib/brand/agent-emails.ts and lib/ai/harness-agents.ts',
  mailboxes: AGENT_MAILBOXES,
  pollingOnly: pollingOnlyHarnessMailboxes(),
  harnessAgents: HARNESS_AGENTS.map(({ mailbox, displayName, label, harnessSelector, hasServerExecutor }) => ({
    mailbox,
    displayName,
    label,
    harnessSelector,
    ...(hasServerExecutor === undefined ? {} : { hasServerExecutor }),
  })),
}))
