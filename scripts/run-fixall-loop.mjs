#!/usr/bin/env node
//
// launchd shim for scripts/fixall-loop.sh.
//
// Two reasons, both load-bearing.
//
// 1. It self-locates. The repo is resolved from this file's own import.meta.url, which is
//    why scripts/launchd/cc.astrid.fixall-web.plist.template names exactly one path
//    (__REPO_ROOT__) and scripts/launchd/install.sh can fill it in for any checkout.
//
// 2. TCC, when the checkout sits somewhere protected. A /bin/zsh launched directly by
//    launchd has no access to ~/Documents, ~/Desktop or ~/Downloads, so git fails with
//    "Unable to read current working directory: Operation not permitted" before the run
//    starts. So launchd runs node, and node runs the real script.
//
// Do not "simplify" this away by pointing launchd straight at the shell script.
//
// THE SHIM IS NECESSARY BUT NOT SUFFICIENT, and the version of this comment copied from
// astrid-ios said otherwise — it claimed "this node binary does hold that grant". On this
// Mac it does not (verified 2026-09-19 with a launchd probe that wrote fine to /tmp and
// then HUNG on readdirSync of the repo). The grant belongs to the binary launchd executes,
// and /opt/homebrew/bin/node has not been given it.
//
// The failure mode is the nasty one: a TCC-protected read from a launchd agent BLOCKS
// pending consent rather than returning EPERM. So the job sits in `state = running` with
// an empty log forever, launchd will not start a second copy of the label, and every later
// tick is silently swallowed. It looks installed and healthy and does nothing.
//
// Fix: System Settings -> Privacy & Security -> Full Disk Access, add the real node binary
// (`readlink -f /opt/homebrew/bin/node`), then bootstrap the agent. Weigh it first: that is
// a broad grant to a general-purpose interpreter.
//
// Better fix, and the one taken on 2026-09-25: keep the checkout out of TCC-protected
// directories altogether. Outside them none of the above applies and no grant is needed.
// Reason 1 still stands, so the shim stays.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const script = join(dirname(fileURLToPath(import.meta.url)), 'fixall-loop.sh')
const { status } = spawnSync('/bin/zsh', ['-l', script, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(status ?? 1)
