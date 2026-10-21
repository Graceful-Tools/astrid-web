/**
 * The server's boot checks, asked of an environment before it is deployed (AWTD-1298).
 *
 * instrumentation.ts refuses to start a deployment whose brand configuration cannot work,
 * and on Vercel a refused boot is a 500 MIDDLEWARE_INVOCATION_FAILED on every route,
 * /api/health included. That is the first a deployer heard of it: brands/github-projects
 * listed `sso`, the documented deploy carried no AUTH_SSO_*, and the preview was dead.
 *
 * The boot checks read CAPABILITIES and AUTH_PROVIDERS, which are fixed at build from
 * literal process.env references (Next inlines them), so they cannot be pointed at
 * another environment. This derives the same answers from an env record instead.
 * tests/brands/boot-preflight.test.ts runs every brand profile through both and fails
 * if they disagree, so a check added to instrumentation.ts must be added here too.
 */

import { resolveAuthProviders } from './auth-providers'
import { enabled, explicitlyEnabled, GITHUB_PROJECTS_REQUIRED_ENV } from './capabilities'
import { checkProviderCredentials } from '@/lib/auth/provider-credentials'

type Env = Record<string, string | undefined>

/** Every reason this environment's boot would be refused, each naming what to set. Empty: it boots. */
export function bootPreflightProblems(env: Env): string[] {
  const problems: string[] = []

  const providers = resolveAuthProviders(env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS, {
    google: enabled(env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE),
    apple: enabled(env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_APPLE),
    passkey: enabled(env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_PASSKEY),
  })
  if (providers.length === 0) {
    problems.push('No sign-in method is enabled: list at least one provider in NEXT_PUBLIC_BRAND_AUTH_PROVIDERS')
  }

  const githubProjects = explicitlyEnabled(env.NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS)
  if (githubProjects && !enabled(env.NEXT_PUBLIC_BRAND_ENABLE_PROJECT_MODE)) {
    problems.push('GitHub Projects requires Project Mode: leave NEXT_PUBLIC_BRAND_ENABLE_PROJECT_MODE on')
  }
  if (githubProjects) {
    const missing = GITHUB_PROJECTS_REQUIRED_ENV.filter((name) => !env[name]?.trim())
    if (missing.length > 0) problems.push(`GitHub Projects is on without its GitHub App: set ${missing.join(', ')}`)
  }

  for (const line of checkProviderCredentials(providers, env).fatal) {
    problems.push(`Sign-in provider listed without its configuration — ${line}`)
  }

  return problems
}
