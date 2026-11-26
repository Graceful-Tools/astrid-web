import { installTestListPermissionsCore } from './helpers/list-permissions-core'
/**
 * Slim setup for the `node` vitest project (ADEV-295).
 *
 * The repo-scanning rule tests and script tests need no DOM, so they skip what
 * tests/setup.ts spends most of its time on per file: jest-dom, fake-indexeddb,
 * en.json and the React / next-auth / SSE mocks. Only the environment variables
 * the shared setup also sets are kept, so code under test reads the same values.
 */
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret'
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000'
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

// astrid-core is the server's only list-permission rule since ADEV-304: without a decider every
// server-side check is refused. Install the vendored core the way instrumentation.ts does.
installTestListPermissionsCore()
