/**
 * Client-safe Project Mode constants.
 *
 * Deliberately import-free. `lib/project-mode.ts` reaches lib/feature-flags →
 * lib/prisma → web-push, so a *value* import of it from a client component
 * drags the whole server stack into the browser bundle and fails the build
 * ("Can't resolve 'tls'"). Client code imports the key from here instead.
 */

export const PROJECT_MODE_FEATURE_KEY = 'project_mode' as const
