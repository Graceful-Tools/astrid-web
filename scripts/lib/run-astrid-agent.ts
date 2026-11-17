/**
 * `astrid-agent` as this repo's scripts run it (ADEV-83): the SDK's own CLI, with the two
 * habits the scripts have and the bare bin does not.
 *
 *   - Credentials come from `.env.local`, which wins over inherited shell exports
 *     (scripts/lib/load-env.ts). The bare bin reads only the environment.
 *   - The origin stays `astrid.cc`, which these scripts always called; the SDK's own default
 *     is `www.astrid.cc`.
 *
 * Everything else — flags, exit codes, log lines — is `astrid-agent`'s.
 */

import { runCli } from '../../packages/astrid-sdk/src/cli'
import { loadScriptEnv } from './load-env'
import { ASTRID_API } from './script-client'

export function runAstridAgent(argv: string[]): void {
  loadScriptEnv()
  const origin = argv.includes('--origin')
    ? []
    : ['--origin', process.env.ASTRID_API_URL ?? process.env.ASTRID_API_BASE_URL ?? ASTRID_API]
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
