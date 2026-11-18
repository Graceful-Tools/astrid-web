/**
 * `astrid-agent` as this repo's scripts run it (ADEV-83): the SDK's own CLI, with the two
 * habits the scripts have and the bare bin does not.
 *
 *   - Credentials come from `.env.local`, which wins over inherited shell exports
 *     (scripts/lib/load-env.ts). The bare bin reads only the environment.
 *   - The origin is scriptApiOrigin() (the brand's own, `astrid.cc` for Astrid); the SDK's
 *     own default is `www.astrid.cc`.
 *
 * Everything else — flags, exit codes, log lines — is `astrid-agent`'s.
 */

import { runCli } from '../../packages/astrid-sdk/src/cli'
import { loadScriptEnv } from './load-env'
import { scriptApiOrigin } from './script-client'

export function runAstridAgent(argv: string[]): void {
  loadScriptEnv()
  const origin = argv.includes('--origin')
    ? []
    : ['--origin', scriptApiOrigin()]
  runCli([...argv, ...origin], {
    env: process.env,
    stdout: line => console.log(line),
    stderr: line => console.error(line),
  }).then(
    code => process.exit(code),
    error => {
      console.error(`astrid-agent: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    },
  )
}
