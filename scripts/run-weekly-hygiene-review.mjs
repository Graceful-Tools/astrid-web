#!/usr/bin/env node
//
// launchd shim for scripts/weekly-hygiene-review.sh.
//
// A /bin/zsh launched directly by launchd has no TCC access to ~/Documents, so git fails
// with "Unable to read current working directory: Operation not permitted" before the
// review starts. This node binary does hold that grant, and children inherit it — the same
// reason cc.astrid.user-feedback works, since it execs `npx tsx`. So launchd runs node, and
// node runs the real script.
//
// Do not "simplify" this away by pointing launchd straight at the shell script.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const script = join(dirname(fileURLToPath(import.meta.url)), 'weekly-hygiene-review.sh')
const { status } = spawnSync('/bin/zsh', ['-l', script, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(status ?? 1)
