import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * True while the vendored astrid-core (packages/astrid-rules) answers a different board than this
 * repo's TypeScript.
 *
 * ADEV-132 moved Waiting before Inbox and renamed Inbox "Ideas" here first (the change order in
 * ASTRID.md). Until astrid-core's `board` rule says the same and the pin is bumped, the vendored
 * fixture and WebAssembly answer the old column list, so a test that needs core and TypeScript to
 * agree on it waits. It turns itself back on when the pinned fixture equals the one this repo
 * exports, which is what bumping the pin does.
 */
const read = (...segments: string[]) => readFileSync(path.join(process.cwd(), ...segments, 'board.json'), 'utf8')

export const corePinBehindBoard =
  JSON.stringify(JSON.parse(read('packages', 'astrid-rules', 'fixtures'))) !==
  JSON.stringify(JSON.parse(read('contracts', 'fixtures')))
