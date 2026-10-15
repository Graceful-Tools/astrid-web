/**
 * Where Turbopack's filesystem root is, when `node_modules` is not really here.
 *
 * A `/fixall` worktree shares the main checkout's dependencies by symlink:
 *
 *   www-task-awtd-1240/node_modules -> /Users/jonparis/mycode/astrid-web/node_modules
 *
 * Turbopack rejects that before compiling anything — `Symlink
 * [project]/node_modules is invalid, it points out of the filesystem root` — so
 * predeploy's Build gate could not pass in any worktree whatsoever, while the
 * rest of the gates (vitest, tsc, eslint) follow the symlink happily. The gate
 * was reporting the worktree, not the code (AWTD-1240).
 *
 * `turbopack.root` is the documented answer: Next's own typings call it "the
 * repo root usually", where "only files above this directory can be resolved".
 * Naming an ancestor of both trees satisfies the constraint the symlink breaks.
 *
 * What this must NOT do is hardcode a path, or widen the root for builds that
 * do not need it. So the decision is made from one fact — is `node_modules` a
 * symlink out of the project? — and in a normal checkout, in CI and on Vercel
 * the answer is no and no root is set at all. A production build resolves and
 * traces exactly as it did before.
 *
 * This is `.mjs` rather than TypeScript because `next.config.mjs` imports it,
 * and the config is loaded before anything is compiled — the same reason
 * scripts/lib/build-migration-policy.js is plain JavaScript. Its tests live in
 * tests/scripts/turbopack-root.test.ts.
 */

import { lstatSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

/**
 * The deepest directory that contains both paths.
 *
 * Segment-wise, not by string prefix: `/a/bbb` is not inside `/a/bb`, and a
 * `startsWith` check would say it is — which would hand Turbopack a root that
 * does not contain the project.
 *
 * @param {string} a
 * @param {string} b
 * @returns {string} an absolute path; `/` when nothing else is shared
 */
export function commonAncestor(a, b) {
  const left = resolve(a).split(sep)
  const right = resolve(b).split(sep)

  const shared = []
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) break
    shared.push(left[i])
  }

  // resolve() guarantees a leading separator, so shared[0] is the empty string
  // and join() reproduces it. Only `/` itself in common leaves nothing to join.
  const joined = shared.join(sep)
  return joined === '' ? sep : joined
}

/**
 * Is `candidate` the directory `parent`, or inside it?
 *
 * @param {string} candidate
 * @param {string} parent
 */
function isInside(candidate, parent) {
  const target = resolve(candidate)
  const base = resolve(parent)
  return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep)
}

/**
 * @typedef {{ linked: false } | { linked: true, realPath: string }} NodeModulesFacts
 */

/**
 * What the filesystem says about this project's `node_modules`.
 *
 * A missing `node_modules` reads the same as a real one — "nothing to widen".
 * The build is going to fail either way, and it should fail saying what is
 * actually wrong rather than from a root invented here.
 *
 * @param {string} projectDir
 * @returns {NodeModulesFacts}
 */
export function nodeModulesFacts(projectDir) {
  const nodeModules = join(projectDir, 'node_modules')
  try {
    if (!lstatSync(nodeModules).isSymbolicLink()) return { linked: false }
    return { linked: true, realPath: realpathSync(nodeModules) }
  } catch {
    return { linked: false }
  }
}

/**
 * The value for `turbopack.root`, or `undefined` to leave it unset.
 *
 * @param {string} projectDir the directory holding next.config.mjs
 * @param {NodeModulesFacts} [facts] injected in tests; read from disk otherwise
 * @returns {string | undefined}
 */
export function turbopackRoot(projectDir, facts = nodeModulesFacts(projectDir)) {
  if (!facts.linked) return undefined

  // A link that lands inside the project needs no wider root: Turbopack can
  // already see it.
  if (isInside(facts.realPath, projectDir)) return undefined

  const root = commonAncestor(projectDir, facts.realPath)

  // `/` would make the whole filesystem the project's root — slower, and a
  // surprise nobody asked for. Let the build fail with its own message instead.
  if (root === sep) return undefined

  return root
}
