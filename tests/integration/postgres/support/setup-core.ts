/**
 * The postgres tier's only setup file (vitest.postgres.config.ts). It must not mock anything:
 * this tier exists to hit a real database. It installs the vendored astrid-core as the list
 * permissions decider, the way instrumentation.ts does on the server. Since ADEV-304 there is
 * no TypeScript permission rule, so without this every permission check in every postgres test
 * is a refusal (a task create with listIds returns ok: false).
 */
import { installTestListPermissionsCore } from '@/tests/helpers/list-permissions-core'

installTestListPermissionsCore()
