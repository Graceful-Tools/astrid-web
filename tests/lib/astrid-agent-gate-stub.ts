/**
 * A stand-in for `npx … astrid-agent queue` (ADEV-8), so a generated gate step
 * can be RUN in a test without the network or npm.
 *
 * The stub is not a fake verdict: it runs the real CLI from packages/astrid-sdk
 * (the code the published package ships) with `fetch` answering from a fixture
 * file. The gate's shell, the SDK's exit codes and its seen-file handling are
 * all the real ones.
 */

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(__dirname, '../..')

/**
 * Writes `<dir>/bin/npx` and returns the bin directory to put on PATH. The fixture
 * is read at call time from `<dir>/fixture.json`; a fixture of `{ "status": 500 }`
 * makes the queue read fail, and the stub records its arguments in `<dir>/npx-args`
 * and the environment it saw in `<dir>/npx-env`.
 */
export function installAgentStub(dir: string): string {
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const preload = join(dir, 'fetch-preload.mjs')
  writeFileSync(
    preload,
    `import { readFileSync } from 'node:fs'
globalThis.fetch = async (url) => {
  const raw = JSON.parse(readFileSync(process.env.ASTRID_FIXTURE, 'utf8'))
  const status = raw.status ?? 200
  const body = String(url).includes('/oauth/token') ? { access_token: 't', expires_in: 3600 } : raw
  return new Response(JSON.stringify(body), { status: String(url).includes('/oauth/token') ? 200 : status, headers: { 'content-type': 'application/json' } })
}
`,
  )
  const npx = join(bin, 'npx')
  writeFileSync(
    npx,
    `#!/bin/bash
echo "$@" > "${join(dir, 'npx-args')}"
env | grep '^ASTRID_' > "${join(dir, 'npx-env')}" || true
while [ "$1" != "astrid-agent" ]; do shift; done
shift
ASTRID_FIXTURE="${join(dir, 'fixture.json')}" exec "${join(REPO, 'node_modules/.bin/tsx')}" --import "${preload}" "${join(REPO, 'packages/astrid-sdk/src/bin.ts')}" "$@"
`,
  )
  chmodSync(npx, 0o755)
  return bin
}
