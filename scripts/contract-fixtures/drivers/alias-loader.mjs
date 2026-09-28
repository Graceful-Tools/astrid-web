// Lets a driver import astrid-web modules that use the `@/…` path alias.
//
// `types/repeating.ts` imports nothing, so the repeating driver could load it directly. Almost
// everything else canonical — list-permissions, date-comparison, task-sort, the parser — imports
// `@/lib/...`, which Node cannot resolve on its own because the alias lives in astrid-web's
// tsconfig.
//
// Rather than build astrid-web (a Next.js build to read four pure functions) this registers a
// synchronous resolve hook that maps `@/x` onto `<webRoot>/x` and tries the extensions TypeScript
// would.
//
// TWO MODULES ARE STUBBED, and both stubs are deliberate:
//
//   @/lib/logger  — pulls in pino and its transports. The canonical functions only log behind a
//                   dev-only debug flag, so a no-op logger changes nothing they return.
//   @/lib/prisma  — opens a database connection at import time. Nothing a contract driver calls
//                   touches it; importing it for real would make fixture generation need a DB.
//
// A stub that silently changed behaviour would be a much worse problem than the build step it
// avoids, so each one is asserted as unused by the driver that relies on it: the fixtures are
// compared against web's real output, and a stub that mattered would show up as a wrong answer.

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const STUBS = {
  '@/lib/logger': join(here, 'stubs', 'logger.mjs'),
  '@/lib/prisma': join(here, 'stubs', 'prisma.mjs'),
  // Imports its types as values, which Node's type stripping cannot load. Nothing a driver
  // calls reaches it; the stub throws if one ever does.
  '@/lib/virtual-list-utils': join(here, 'stubs', 'virtual-list-utils.mjs'),
}

// The order TypeScript's resolver would try, narrowed to what astrid-web actually contains.
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx', '/index.ts']

/**
 * Install the hook. Call once, before importing anything from the web checkout.
 *
 * @param {string} webRoot absolute path to the astrid-web checkout
 */
export function registerWebAliases(webRoot) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      // A relative import with no extension — `./date-comparison` from date-utils.ts — is what
      // TypeScript writes and what Node's ESM loader refuses. Resolve it the way TypeScript
      // would, but only for files inside the web checkout; everything else is Node's business.
      if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
        const parent = fileURLToPath(context.parentURL)
        if (parent.startsWith(webRoot)) {
          const base = join(dirname(parent), specifier)
          if (!existsSync(base) || !/\.[a-z]+$/.test(specifier)) {
            for (const ext of EXTENSIONS) {
              const candidate = base + ext
              if (existsSync(candidate)) {
                return { url: pathToFileURL(candidate).href, shortCircuit: true }
              }
            }
          }
        }
        return nextResolve(specifier, context)
      }

      if (!specifier.startsWith('@/')) return nextResolve(specifier, context)

      const stub = STUBS[specifier]
      if (stub) return { url: pathToFileURL(stub).href, shortCircuit: true }

      const base = join(webRoot, specifier.slice(2))
      for (const ext of EXTENSIONS) {
        const candidate = base + ext
        if (existsSync(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true }
        }
      }

      // Loud on purpose. A driver that silently resolved to nothing would export a fixture built
      // from a half-loaded module, and the Rust tests would then lock in that half.
      throw new Error(
        `alias-loader: cannot resolve ${specifier} under ${webRoot}. ` +
          `Add an extension to EXTENSIONS, or a stub if the module is not needed.`,
      )
    },
  })
}
