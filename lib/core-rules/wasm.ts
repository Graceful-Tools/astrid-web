/**
 * astrid-core's rules door, as WebAssembly — server (Node runtime) only.
 *
 * `runJson` is astrid-core's `rules::run_json`: one JSON request in, one `{ ok, value?, error? }`
 * envelope out, the same function the iOS and Mac apps call through UniFFI. The build is vendored
 * in packages/astrid-rules/ at the revision in its REVISION file (scripts/build-astrid-rules.sh).
 *
 * Never import this from a client component or from middleware.ts: it reads the .wasm from disk.
 * It is loaded through a require resolved at runtime rather than an import, so neither bundler
 * tries to pack the wasm-bindgen glue (whose `__dirname` must stay the real directory); the files
 * reach a Vercel function through `outputFileTracingIncludes` in next.config.mjs.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

export interface CoreRules {
  /** astrid-core `rules::run_json`. Answers malformed input with an error envelope. */
  runJson(request: string): string
  /** The astrid-core commit the vendored build came from. */
  revision: string
}

const PACKAGE_DIR = path.join(process.cwd(), 'packages', 'astrid-rules')

/** Load the vendored build from `dir`. Throws if it is missing or does not instantiate. */
export function loadCoreRulesFrom(dir: string): CoreRules {
  const requireFromPackage = createRequire(path.join(dir, 'node', 'package.json'))
  const glue = requireFromPackage('./astrid_rules_wasm.js') as { runJson(request: string): string }
  const revision = readFileSync(path.join(dir, 'REVISION'), 'utf8').trim()
  return { runJson: (request) => glue.runJson(request), revision }
}

let cached: CoreRules | null | undefined

/**
 * The vendored build, loaded once per process; `null` when it cannot be loaded. Never throws —
 * a caller that only shadows the TypeScript rules must not be able to fail because of this.
 */
export function loadCoreRules(): CoreRules | null {
  if (cached === undefined) {
    try {
      cached = loadCoreRulesFrom(PACKAGE_DIR)
    } catch {
      cached = null
    }
  }
  return cached
}
