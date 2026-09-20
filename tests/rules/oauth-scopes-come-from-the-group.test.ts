/**
 * Provisioning paths take scopes from SCOPE_GROUPS, not from a literal list
 * (task 9ebfaba7).
 *
 * Six places wrote their own scope array. They drifted, silently and in
 * different directions: `lib/astrid-api-client.ts` carried the same six-scope
 * list three times and omitted `chat:read`/`chat:write`/`sse:connect`;
 * `custom-agents/register` omitted four that `ai_agent` carries;
 * `setup-ios-oauth.ts` held 17 of `mobile_app`'s 24. The visible symptom was
 * every client-credentials token 403ing on the v1 chat routes.
 *
 * Fixing the six is worth little if a seventh can be added tomorrow, so this
 * pins the rule rather than the instance.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/** Files that provision or re-scope an OAuth client. */
const PROVISIONING_PATHS = [
  'lib/astrid-api-client.ts',
  'app/api/v1/custom-agents/register/route.ts',
  'scripts/setup-ios-oauth.ts',
  'scripts/test-oauth-local.ts',
  'scripts/test-oauth-locally.ts',
  'lib/oauth/oauth-client-presets.ts',
]

/**
 * A scope literal next to a `scopes:` key — the shape the drift took. Matching
 * the assignment rather than the bare string keeps this from firing on the
 * scope ENUM and the groups themselves, which must obviously hold literals.
 */
const LITERAL_SCOPE_ASSIGNMENT = /scopes:\s*\[\s*'[a-z]+:[a-z_]+'/

describe('OAuth scopes come from the group (task 9ebfaba7)', () => {
  it.each(PROVISIONING_PATHS)('%s takes its scopes from SCOPE_GROUPS', file => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')

    expect(
      LITERAL_SCOPE_ASSIGNMENT.test(source),
      `${file} assigns a literal scope list. Use SCOPE_GROUPS so adding a scope ` +
        `to a group reaches this path too — that is the whole point of the group.`,
    ).toBe(false)
    expect(source, `${file} should reference SCOPE_GROUPS`).toContain('SCOPE_GROUPS')
  })

  it('leaves the scope definitions themselves alone', () => {
    // The guard must not be vacuous: oauth-scopes.ts is where literals belong,
    // and it would fail the rule above if the rule were written carelessly.
    const scopesFile = readFileSync(join(process.cwd(), 'lib/oauth/oauth-scopes.ts'), 'utf8')

    expect(scopesFile).toContain("'tasks:read'")
    expect(PROVISIONING_PATHS).not.toContain('lib/oauth/oauth-scopes.ts')
  })
})
