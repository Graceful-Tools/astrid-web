#!/usr/bin/env tsx
/**
 * Print the failed-step logs of a CI run (ADEV-338). Read-only: it only runs `gh run list`,
 * `gh run view` and `gh pr view`, with the read-only Actions token (CI_LOGS_GH_TOKEN) in place of
 * GH_TOKEN for the run reads; the PR lookup uses the agent's own GH_TOKEN, since the Actions
 * token cannot read pull requests. Rules and the reason: scripts/lib/ci-logs.ts.
 *
 * Usage (npm run ci:logs -- ...):
 *   --run <id>        the failed-step log of that run
 *   --branch <name>   the newest runs on the branch; the failed-step log of the newest red one
 *   --pr <number>     the same, for the PR's head branch
 *   --tail <lines>    keep the last N lines of the log (default 200)
 */
import { execFileSync } from 'node:child_process'
import {
  ciLogsEnv,
  failedLogArgs,
  parseCiLogsArgs,
  prBranchArgs,
  runListArgs,
  tailLines,
} from './lib/ci-logs'

interface RunRow {
  databaseId: number
  workflowName: string
  status: string
  conclusion: string | null
  headSha: string
  url: string
}

function main() {
  const { target, tail } = parseCiLogsArgs(process.argv.slice(2))
  const env = ciLogsEnv(process.env) as NodeJS.ProcessEnv
  const run = (args: string[], with_: NodeJS.ProcessEnv) =>
    execFileSync('gh', args, { env: with_, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 })
  const gh = (args: string[]) => run(args, env)

  let runId: string
  if (target.kind === 'run') {
    runId = target.runId
  } else {
    const branch = target.kind === 'pr' ? run(prBranchArgs(target.number), process.env).trim() : target.branch
    const runs = JSON.parse(gh(runListArgs(branch))) as RunRow[]
    for (const run of runs) {
      console.log(`${run.databaseId}  ${run.workflowName}  ${run.status}/${run.conclusion ?? '-'}  ${run.headSha.slice(0, 7)}  ${run.url}`)
    }
    const red = runs.find(run => run.conclusion === 'failure')
    if (!red) {
      console.log(`CI: no failed run among the newest ${runs.length} on ${branch}`)
      return
    }
    runId = String(red.databaseId)
    console.log(`\nCI: failed-step log of run ${runId}\n`)
  }
  console.log(tailLines(gh(failedLogArgs(runId)), tail))
}

try {
  main()
} catch (error) {
  console.error(`ci-logs failed: ${error instanceof Error ? error.message.split('\n')[0] : error}`)
  process.exit(1)
}
