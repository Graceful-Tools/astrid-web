/**
 * The registry of every environment variable this app reads.
 *
 * There was no such registry: 150 variables were read across the codebase,
 * 88 appeared in .env.example, and neither list knew about the other. Two
 * consequences, both of which happened:
 *
 *   - Secrets that gate real behaviour (GITHUB_SYNC_CLIENT_SECRET,
 *     MAILGUN_WEBHOOK_SIGNING_KEY, CLOUDFLARE_EMAIL_WEBHOOK_SECRET …) were
 *     undocumented, so a deployment silently ran without them.
 *   - CRON_SECRET was absent from the validator for months while
 *     lib/cron-auth.ts failed closed on it, so all five cron routes 401'd —
 *     no reminders, digests, analytics, sync or cleanup — with nothing in any
 *     check saying so (task a5eb65a4).
 *
 * scripts/check-env-schema.ts diffs this registry against .env.example AND
 * against the actual `process.env` reads in source, in both directions, and
 * fails predeploy on any drift. scripts/validate-production-env.ts checks a
 * live environment against the same registry, so the two cannot disagree.
 *
 * ── A CONSTRAINT THAT LOOKS LIKE AN OVERSIGHT ────────────────────────────────
 * This module deliberately does NOT export typed accessors that the brand
 * modules read through. `process.env.NEXT_PUBLIC_*` must be referenced
 * LITERALLY for Next.js to inline it into the client bundle; behind an
 * accessor function every brand value is `undefined` in the browser. See the
 * note at the top of lib/brand/config.ts. The registry documents and validates
 * those variables without changing how they are read.
 */

/**
 * How a variable is supplied, which decides whether it belongs in
 * .env.example at all.
 */
export type EnvScope =
  /** Must be set in production. Absence is an outage. */
  | 'required'
  /** Enables a feature. Absence degrades gracefully. */
  | 'optional'
  /** Injected by the host (Vercel, Node, CI). Never authored by an operator. */
  | 'platform'
  /** Read only by scripts, tests or local tooling. */
  | 'tooling'

export interface EnvVar {
  name: string
  scope: EnvScope
  /** One line: what breaks without it, or what it turns on. */
  description: string
  /** Optional shape check, used by validate-production-env. */
  validate?: (value: string) => string | null
  /**
   * Consumed by a third-party library rather than by this codebase, so the
   * drift scanner cannot see a read for it. Still operator-authored, so it
   * belongs in .env.example.
   */
  readExternally?: boolean
}

const isUrl = (v: string) =>
  /^https?:\/\//.test(v) ? null : 'Must be an absolute http(s) URL'
const isPostgres = (v: string) =>
  /^postgres(ql)?:\/\//.test(v) ? null : 'Must be a postgres:// connection string'
const isEmail = (v: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Must be an email address'
const isHexColour = (v: string) =>
  /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? null : 'Must be a hex colour, e.g. #a855f7'
const isDomain = (v: string) =>
  /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? null : 'Must be a bare domain, no scheme'
const minLength = (n: number) => (v: string) =>
  v.length >= n ? null : `Must be at least ${n} characters`

export const ENV_VARS: EnvVar[] = [
  // ── Database ──────────────────────────────────────────────────────────────
  { name: 'DATABASE_URL', scope: 'required', description: 'Pooled Postgres connection used by every runtime query.', validate: isPostgres },
  { name: 'DATABASE_URL_DIRECT', scope: 'required', description: 'Unpooled Postgres connection; migrations run through it at deploy time.', validate: isPostgres },
  { name: 'DATABASE_URL_PROD', scope: 'tooling', description: 'Production pooled URL, for local deploy/backup scripts.' },
  { name: 'DATABASE_URL_DIRECT_PROD', scope: 'tooling', description: 'Production direct URL, for local migration scripts.' },
  { name: 'PRODUCTION_DATABASE_URL', scope: 'tooling', description: 'Legacy alias read by older maintenance scripts.' },
  { name: 'AUTO_MIGRATE_ON_STARTUP', scope: 'optional', description: 'Set to "true" to run pending migrations at server start. Off by default: migrations belong to the deploy.' },
  { name: 'ALLOW_PRODUCTION_DESTRUCTIVE', scope: 'tooling', description: 'Safety interlock that destructive maintenance scripts require.' },

  // ── Authentication ────────────────────────────────────────────────────────
  { name: 'NEXTAUTH_SECRET', scope: 'required', description: 'Signs session JWTs and WebAuthn state. Rotating it signs everyone out.', validate: minLength(32) },
  { name: 'NEXTAUTH_URL', scope: 'required', description: 'Canonical absolute origin. NextAuth callbacks and every absolute link in /llms.txt derive from it.', validate: isUrl },
  { name: 'NEXT_PUBLIC_BASE_URL', scope: 'optional', description: 'Client-visible base URL; falls back to the brand origin.', validate: isUrl },
  { name: 'NEXT_PUBLIC_API_URL', scope: 'optional', description: 'Overrides the API origin for a split-host deployment.', validate: isUrl },
  { name: 'NEXT_PUBLIC_APP_URL', scope: 'optional', description: 'Overrides the app origin used in client-side links.', validate: isUrl },
  { name: 'GOOGLE_CLIENT_ID', scope: 'optional', description: 'Google sign-in. Required when the authGoogle capability is on.' },
  { name: 'GOOGLE_CLIENT_SECRET', scope: 'optional', description: 'Google sign-in secret.' },
  { name: 'GOOGLE_ALLOWED_AUDIENCES', scope: 'optional', description: 'Extra Google client ids whose ID tokens are accepted (comma-separated).' },
  { name: 'APPLE_CLIENT_IDS', scope: 'optional', description: 'Apple client ids whose identity tokens are accepted (comma-separated); adds to the iOS bundle id.' },
  { name: 'INITIAL_ADMIN_EMAIL', scope: 'optional', description: 'Address granted admin on bootstrap. Unset means no bootstrap admin at all.', validate: isEmail },
  { name: 'NEXT_PUBLIC_BRAND_WEBAUTHN_RP_ID', scope: 'optional', description: 'Overrides the WebAuthn RP ID. Changing it on a live deployment invalidates every registered passkey.' },

  // ── Email ─────────────────────────────────────────────────────────────────
  { name: 'RESEND_API_KEY', scope: 'optional', description: 'Outbound email. Without it nothing is sent and sends are logged instead.' },
  { name: 'FROM_EMAIL', scope: 'optional', description: 'From address for outbound mail. Defaults to noreply@<brand domain>.', validate: isEmail },
  { name: 'RESEND_WEBHOOK_SECRET', scope: 'optional', description: 'Svix signing secret (whsec_…) verifying inbound Resend email-to-task webhooks. Without it the route rejects everything.' },
  { name: 'MAILGUN_WEBHOOK_SIGNING_KEY', scope: 'optional', description: 'Verifies inbound Mailgun email-to-task webhooks. Without it the route rejects everything.' },
  { name: 'CLOUDFLARE_EMAIL_WEBHOOK_SECRET', scope: 'optional', description: 'Verifies inbound Cloudflare Email Routing webhooks.' },
  { name: 'FEATURE_REQUEST_EMAIL', scope: 'optional', description: 'Recipient for feature-access requests.', validate: isEmail },

  // ── Scheduled jobs ────────────────────────────────────────────────────────
  { name: 'CRON_SECRET', scope: 'required', description: 'REQUIRED: lib/cron-auth.ts fails closed, so all five cron routes 401 without it — no reminders, digests, analytics, sync or upload cleanup.' },
  { name: 'ALLOW_UNAUTHENTICATED_CRON', scope: 'tooling', description: 'Local-only escape hatch for hitting cron routes without a secret. Ignored when NODE_ENV=production, by design.' },

  // ── Storage, cache, push ──────────────────────────────────────────────────
  { name: 'BLOB_READ_WRITE_TOKEN', scope: 'optional', description: 'Vercel Blob storage for attachments and uploads.' },
  { name: 'REMOTE_IMAGE_ALLOWED_HOSTS', scope: 'optional', description: 'Comma-separated HTTPS hosts the remote-image import route accepts. Empty disables remote imports.' },
  { name: 'REDIS_URL', scope: 'optional', description: 'Local Redis for development.' },
  { name: 'UPSTASH_REDIS_REST_URL', scope: 'optional', description: 'Serverless Redis. Without it rate limits fall back to a per-instance memory store.', validate: isUrl },
  { name: 'UPSTASH_REDIS_REST_TOKEN', scope: 'optional', description: 'Upstash Redis token.' },
  { name: 'VAPID_PUBLIC_KEY', scope: 'optional', description: 'Web push. Without the pair, push notifications are disabled.' },
  { name: 'VAPID_PRIVATE_KEY', scope: 'optional', description: 'Web push private key.' },
  { name: 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', scope: 'optional', description: 'Web push public key, needed in the browser to subscribe.' },
  { name: 'VAPID_SUBJECT', scope: 'optional', description: 'mailto: contact required by the web-push spec.' },
  { name: 'CORS_ALLOWED_ORIGINS', scope: 'optional', description: 'Extra origins allowed credentialed cross-origin API access, beyond the brand apex and www.' },

  // ── Encryption ────────────────────────────────────────────────────────────
  { name: 'ENCRYPTION_KEY', scope: 'required', description: 'Encrypts stored user API keys and OAuth credentials at rest. Losing it makes them unrecoverable.', validate: minLength(32) },
  { name: 'INTERNAL_API_SECRET', scope: 'optional', description: 'Shared secret for the /api/internal/* routes (legacy-usage census, model preferences), matched against the X-Internal-Secret header. Unset leaves those routes unreachable.' },

  // ── AI agents ─────────────────────────────────────────────────────────────
  // NOT read by the running app. Server-run inference uses the key each USER
  // stores in their own settings, encrypted at rest with ENCRYPTION_KEY — see
  // lib/ai/agent-execution-mode.ts. These four are read only by maintenance and
  // model-probing scripts, so .env.example told operators to configure four
  // keys the deployment never looks at (task 0c387855).
  { name: 'ANTHROPIC_API_KEY', scope: 'tooling', description: 'Claude key for model-probing and maintenance scripts. The app uses per-user keys.' },
  { name: 'OPENAI_API_KEY', scope: 'tooling', description: 'OpenAI key for scripts. The app uses per-user keys.' },
  { name: 'GEMINI_API_KEY', scope: 'tooling', description: 'Gemini key for scripts. The app uses per-user keys.' },
  { name: 'CLAUDE_API_KEY', scope: 'tooling', description: 'Legacy alias for ANTHROPIC_API_KEY, read by older scripts.' },
  { name: 'BRAND_ENABLED_AGENTS', scope: 'optional', description: 'Comma-separated agent mailboxes this deployment offers. Unset means all of them.' },
  { name: 'CLAUDE_AGENT_EMAIL', scope: 'tooling', description: 'Agent mailbox used by local agent scripts.' },
  { name: 'CLAUDE_AGENT_ID', scope: 'tooling', description: 'Agent user id used by local agent scripts.' },
  { name: 'CLAUDE_REMOTE_URL', scope: 'optional', description: 'Endpoint for the remote Claude Code runner.' },
  { name: 'CLAUDE_REMOTE_WEBHOOK_URL', scope: 'optional', description: 'Callback URL the remote runner posts results to.' },
  { name: 'CLAUDE_REMOTE_WEBHOOK_SECRET', scope: 'optional', description: 'Verifies callbacks from the remote Claude Code runner.' },

  // ── GitHub ────────────────────────────────────────────────────────────────
  { name: 'GITHUB_APP_ID', scope: 'optional', description: 'GitHub App id for repository integration.' },
  { name: 'GITHUB_APP_PRIVATE_KEY', scope: 'optional', description: 'GitHub App RSA private key. Without it no App-authenticated call works.' },
  // The Issues-sync OAuth app (GITHUB_SYNC_*) is what actually performs the
  // user-facing OAuth; these two are read by setup scripts only.
  { name: 'GITHUB_CLIENT_ID', scope: 'tooling', description: 'GitHub App OAuth client id, read by setup scripts.' },
  { name: 'GITHUB_CLIENT_SECRET', scope: 'tooling', description: 'GitHub App OAuth client secret, read by setup scripts.' },
  { name: 'GITHUB_WEBHOOK_SECRET', scope: 'optional', description: 'Verifies GitHub App webhooks.' },
  { name: 'GITHUB_TOKEN', scope: 'tooling', description: 'Personal access token used by maintenance scripts and the gh CLI.' },
  { name: 'GH_TOKEN', scope: 'tooling', description: 'Alternative token name the gh CLI accepts.' },
  { name: 'GITHUB_SYNC_CLIENT_ID', scope: 'optional', description: 'OAuth app (scope: repo) for two-way GitHub Issues sync — separate from the GitHub App.' },
  { name: 'GITHUB_SYNC_CLIENT_SECRET', scope: 'optional', description: 'Secret for the Issues-sync OAuth app.' },
  { name: 'GITHUB_SYNC_WEBHOOK_SECRET', scope: 'optional', description: 'Verifies Issues-sync webhooks.' },
  { name: 'GITHUB_COPILOT_CLIENT_ID', scope: 'optional', description: 'Per-user Copilot OAuth, so inference bills each user’s own subscription.' },
  { name: 'GITHUB_COPILOT_CLIENT_SECRET', scope: 'optional', description: 'Copilot OAuth secret.' },
  // Read by the Copilot SDK itself rather than by this codebase, so the scanner
  // cannot see it; documented because an operator may need to set it.
  { name: 'COPILOT_CLI_URL', scope: 'optional', readExternally: true, description: 'External headless Copilot runtime. Unset uses the SDK’s bundled one.' },

  // ── Google sync ───────────────────────────────────────────────────────────
  { name: 'GOOGLE_SYNC_CLIENT_ID', scope: 'optional', description: 'OAuth app for Google Tasks sync — separate from sign-in.' },
  { name: 'GOOGLE_SYNC_CLIENT_SECRET', scope: 'optional', description: 'Secret for the Google Tasks sync OAuth app.' },
  { name: 'LIST_IMAGE_GEN_API_KEY', scope: 'tooling', description: 'OpenAI key for the offline list-image generation script.' },

  // ── MCP ───────────────────────────────────────────────────────────────────
  { name: 'ASTRID_API_BASE_URL', scope: 'optional', description: 'API base the standalone MCP servers call. Defaults to this brand’s own origin.', validate: isUrl },
  { name: 'ASTRID_API_URL', scope: 'tooling', description: 'API base used by the SDK and local scripts.', validate: isUrl },
  { name: 'ASTRID_API_BASE', scope: 'tooling', description: 'Legacy alias read by older scripts.' },
  { name: 'ASTRID_OAUTH_CLIENT_ID', scope: 'optional', description: 'OAuth client the MCP server authenticates as.' },
  { name: 'ASTRID_OAUTH_CLIENT_SECRET', scope: 'optional', description: 'Secret for that OAuth client.' },
  { name: 'ASTRID_OAUTH_LIST_ID', scope: 'optional', description: 'Default list the MCP server scopes to.' },
  { name: 'ASTRID_MCP_AUTH_TOKEN', scope: 'optional', description: 'Static access token for the MCP server, instead of client credentials.' },
  { name: 'ASTRID_MCP_HTTP_AUTH_TOKEN', scope: 'optional', description: 'Shared secret for the HTTP/SSE MCP transport. Without it, anyone with the URL can issue API calls.' },
  { name: 'ASTRID_MCP_HTTP_PORT', scope: 'optional', description: 'Port for the HTTP/SSE MCP transport.' },
  { name: 'ASTRID_MCP_SSE_PATH', scope: 'optional', description: 'SSE path for the HTTP MCP transport.' },
  { name: 'ASTRID_MCP_POST_PATH', scope: 'optional', description: 'Message POST path for the HTTP MCP transport.' },
  { name: 'ASTRID_MCP_HEALTH_PATH', scope: 'optional', description: 'Health path for the HTTP MCP transport.' },
  { name: 'ASTRID_MCP_ALLOWED_HOSTS', scope: 'optional', description: 'Host allowlist for the HTTP MCP transport (DNS-rebinding protection).' },
  { name: 'ASTRID_MCP_ALLOWED_ORIGINS', scope: 'optional', description: 'Origin allowlist for the HTTP MCP transport.' },
  { name: 'ASTRID_MCP_ENABLE_DNS_PROTECTION', scope: 'optional', description: 'Enables DNS-rebinding protection on the HTTP MCP transport.' },
  { name: 'ASTRID_WEBHOOK_SECRET', scope: 'optional', description: 'Verifies inbound AI-agent webhooks.' },
  { name: 'MCP_TOKEN', scope: 'tooling', description: 'MCP token used by local validation scripts.' },
  { name: 'FIXALL_CLAIM_BOARD_IDS', scope: 'optional', description: 'Boards an atomic /fixall claim may target. A security allowlist; unset keeps this deployment’s defaults.' },

  // ── Brand ─────────────────────────────────────────────────────────────────
  { name: 'NEXT_PUBLIC_BRAND_NAME', scope: 'optional', description: 'Short product name.' },
  { name: 'NEXT_PUBLIC_BRAND_TITLE', scope: 'optional', description: 'Full product title for <title>, OpenGraph and the manifest.' },
  { name: 'NEXT_PUBLIC_BRAND_TAGLINE', scope: 'optional', description: 'One-line description used in metadata.' },
  { name: 'NEXT_PUBLIC_BRAND_DOMAIN', scope: 'optional', description: 'Apex domain, no scheme. Drives the redirect target, CORS allow-list and base URL.', validate: isDomain },
  { name: 'NEXT_PUBLIC_BRAND_SUPPORT_EMAIL', scope: 'optional', description: 'Support address shown to users.', validate: isEmail },
  { name: 'NEXT_PUBLIC_BRAND_INBOUND_TASK_EMAIL', scope: 'optional', description: 'Address that turns inbound email into tasks.', validate: isEmail },
  { name: 'NEXT_PUBLIC_BRAND_ACCENT_COLOR', scope: 'optional', description: 'Accent colour: default list colour, focus ring, email chrome, theme_color.', validate: isHexColour },
  { name: 'NEXT_PUBLIC_BRAND_AGENT_NAME', scope: 'optional', description: 'Display name of the built-in assistant identity.' },
  { name: 'BRAND_AGENT_EMAIL_DOMAIN', scope: 'optional', description: 'Domain for agent mailboxes. Defaults to the brand domain.', validate: isDomain },
  { name: 'NEXT_PUBLIC_BRAND_LOGO', scope: 'optional', description: 'Path to the mascot/character artwork.' },
  { name: 'NEXT_PUBLIC_BRAND_ICON', scope: 'optional', description: 'Path to the large square app mark.' },
  { name: 'NEXT_PUBLIC_BRAND_ICON_SMALL', scope: 'optional', description: 'Path to the small square app mark.' },
  { name: 'NEXT_PUBLIC_BRAND_WORDMARK', scope: 'optional', description: 'Wordmark as drawn in the header lockup.' },
  { name: 'NEXT_PUBLIC_BRAND_SLOGAN', scope: 'optional', description: 'Short slogan beside the wordmark.' },
  { name: 'NEXT_PUBLIC_BRAND_APP_STORE_URL', scope: 'optional', description: 'App Store listing. Empty string hides the download button entirely.' },
  { name: 'NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG', scope: 'optional', description: 'Slug of the GitHub App users install.' },
  { name: 'NEXT_PUBLIC_BRAND_COPY', scope: 'optional', description: 'JSON overriding the brand voice — reminder nags and default-list captions.' },

  // ── Capabilities ──────────────────────────────────────────────────────────
  { name: 'NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE', scope: 'optional', description: 'Google sign-in. At least one auth method must remain enabled.' },
  { name: 'NEXT_PUBLIC_BRAND_ENABLE_AUTH_APPLE', scope: 'optional', description: 'Sign in with Apple.' },
  { name: 'NEXT_PUBLIC_BRAND_ENABLE_AUTH_PASSKEY', scope: 'optional', description: 'WebAuthn passkeys.' },
  { name: 'NEXT_PUBLIC_BRAND_ENABLE_SYNC_GOOGLE_TASKS', scope: 'optional', description: 'Google Tasks sync.' },
  { name: 'NEXT_PUBLIC_BRAND_ENABLE_SYNC_GITHUB_ISSUES', scope: 'optional', description: 'GitHub Issues sync, including its webhook and cron.' },
  { name: 'NEXT_PUBLIC_BRAND_ENABLE_MCP', scope: 'optional', description: 'MCP server and its discovery documents.' },
  { name: 'NEXT_PUBLIC_BRAND_ENABLE_OPENCLAW', scope: 'optional', description: 'User-operated Custom Agents over OAuth, REST and SSE.' },
  { name: 'NEXT_PUBLIC_BRAND_ENABLE_CHATGPT_ACTIONS', scope: 'optional', description: 'OpenAPI and ai-plugin discovery documents.' },
  { name: 'NEXT_PUBLIC_BRAND_ENABLE_EMAIL_TO_TASK', scope: 'optional', description: 'Creating tasks by emailing the inbound address.' },
  { name: 'NEXT_PUBLIC_BRAND_ENABLE_CALENDAR_FEED', scope: 'optional', description: 'Public .ics calendar feed.' },
  { name: 'NEXT_PUBLIC_BRAND_ENABLE_PROJECT_MODE', scope: 'optional', description: 'Projects and status boards. Off compiles back to the single-player to-do app.' },
  { name: 'NEXT_PUBLIC_BRAND_ENABLE_TASK_COST', scope: 'optional', description: 'Per-task cost tracking.' },

  // ── Analytics and observability ───────────────────────────────────────────
  { name: 'NEXT_PUBLIC_POSTHOG_KEY', scope: 'optional', description: 'PostHog project key. Unset disables product analytics.' },
  { name: 'NEXT_PUBLIC_POSTHOG_HOST', scope: 'optional', description: 'PostHog ingestion host.' },
  { name: 'LOG_LEVEL', scope: 'optional', description: 'Pino log level. Defaults to info.' },
  { name: 'OTEL_SERVICE_NAME', scope: 'optional', description: 'Service name reported to tracing.' },
  { name: 'NEXT_PUBLIC_DEBUG_PERMISSIONS', scope: 'tooling', description: 'Logs permission decisions in the browser.' },

  // ── Apple / App Store ─────────────────────────────────────────────────────
  { name: 'TESTFLIGHT_PUBLIC_LINK', scope: 'optional', description: 'Public TestFlight join link shown on the download page.' },
  { name: 'APPLE_APP_STORE_APP_ID', scope: 'tooling', description: 'App Store app id used by release scripts.' },
  { name: 'APPLE_ASC_ISSUER_ID', scope: 'tooling', description: 'App Store Connect API issuer id.' },
  { name: 'APPLE_ASC_KEY_ID', scope: 'tooling', description: 'App Store Connect API key id.' },
  { name: 'APPLE_ASC_PRIVATE_KEY', scope: 'tooling', description: 'App Store Connect API private key.' },
  { name: 'ASC_APP_ID', scope: 'tooling', description: 'Short alias for APPLE_APP_STORE_APP_ID read by lib/app-store-connect-client.ts.' },
  { name: 'ASC_ISSUER_ID', scope: 'tooling', description: 'Short alias for APPLE_ASC_ISSUER_ID.' },
  { name: 'ASC_KEY_ID', scope: 'tooling', description: 'Short alias for APPLE_ASC_KEY_ID.' },
  { name: 'ASC_PRIVATE_KEY', scope: 'tooling', description: 'Short alias for APPLE_ASC_PRIVATE_KEY.' },

  // ── Deployment tooling ────────────────────────────────────────────────────
  { name: 'VERCEL_TOKEN', scope: 'tooling', description: 'Vercel CLI token for deploy scripts.' },
  { name: 'VERCEL_API_TOKEN', scope: 'tooling', description: 'Vercel REST API token for log and deployment queries.' },
  { name: 'VERCEL_TEAM_ID', scope: 'tooling', description: 'Vercel team scope for API queries.' },
  { name: 'VERCEL_PROJECT_ID', scope: 'tooling', description: 'Vercel project scope for API queries.' },
  { name: 'VERCEL_GIT_EMAIL', scope: 'tooling', description: 'Git author email for agent commits; must be a Vercel team member.' },
  { name: 'VERCEL_GIT_NAME', scope: 'tooling', description: 'Git author name for agent commits.' },
  { name: 'NEXT_DEV_PORT', scope: 'tooling', description: 'Preferred port for the dev server.' },
  { name: 'CHECK_REUSE_STRICT', scope: 'tooling', description: 'Forces check:reuse into strict mode.' },
  { name: 'API_BOUNDARY_BASE', scope: 'tooling', description: 'Git ref the API-boundary guard diffs against.' },

  // ── Test-only ─────────────────────────────────────────────────────────────
  { name: 'PLAYWRIGHT_TEST_BASE_URL', scope: 'tooling', description: 'Base URL for end-to-end runs.' },
  { name: 'PLAYWRIGHT_TEST_EMAIL', scope: 'tooling', description: 'Account used by authenticated e2e runs.' },
  { name: 'PLAYWRIGHT_TEST_PASSWORD', scope: 'tooling', description: 'Password for that account.' },
  { name: 'PLAYWRIGHT_AUTHENTICATED', scope: 'tooling', description: 'Marks an authenticated e2e project.' },
  { name: 'TEST_EMAIL', scope: 'tooling', description: 'Recipient for email test scripts.' },
  { name: 'TEST_USER_ID', scope: 'tooling', description: 'User id used by local test scripts.' },
  { name: 'COMMENT_AUTHOR_ID', scope: 'tooling', description: 'Author id used by comment test scripts.' },
  { name: 'ASTRID_BUGS_LIST_ID', scope: 'tooling', description: 'List id used by feedback scripts.' },
  { name: 'ASTRID_FEEDBACK_LIST_ID', scope: 'tooling', description: 'List id used by feedback scripts.' },
  { name: 'ASTRID_IOS_LIST_ID', scope: 'tooling', description: 'iOS board id used by cross-repo filing scripts.' },
  { name: 'ASTRID_IOS_LIST_NAME', scope: 'tooling', description: 'iOS board name used by cross-repo filing scripts.' },
  { name: 'ASTRID_IOS_GITHUB_TOKEN', scope: 'tooling', description: 'Token for filing issues on the iOS repository.' },

  // ── Platform-injected (never authored by an operator) ─────────────────────
  { name: 'NODE_ENV', scope: 'platform', description: 'Set by the runtime.' },
  { name: 'CI', scope: 'platform', description: 'Set by the CI runner.' },
  { name: 'PORT', scope: 'platform', description: 'Set by the host.' },
  { name: 'HOSTNAME', scope: 'platform', description: 'Set by the host.' },
  { name: 'VERCEL', scope: 'platform', description: 'Set by Vercel when building or running on their platform.' },
  { name: 'VERCEL_ENV', scope: 'platform', description: 'production | preview | development, set by Vercel.' },
  { name: 'VERCEL_URL', scope: 'platform', description: 'Deployment URL, set by Vercel.' },
  { name: 'VERCEL_GIT_COMMIT_SHA', scope: 'platform', description: 'Commit SHA, set by Vercel.' },
  { name: 'NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA', scope: 'platform', description: 'Commit SHA exposed to the client, set by Vercel.' },
  { name: 'GIT_COMMIT_SHA', scope: 'platform', description: 'Commit SHA in non-Vercel builds.' },
  { name: '__NEXT_PRIVATE_ORIGIN', scope: 'platform', description: 'Internal Next.js value; read only as a fallback.' },
]

export const ENV_BY_NAME: Map<string, EnvVar> = new Map(ENV_VARS.map((v) => [v.name, v]))

/** Variables an operator is expected to author, i.e. what belongs in .env.example. */
export function documentedVars(): EnvVar[] {
  return ENV_VARS.filter((v) => v.scope === 'required' || v.scope === 'optional')
}

/** Variables whose absence in production is an outage. */
export function requiredVars(): EnvVar[] {
  return ENV_VARS.filter((v) => v.scope === 'required')
}
