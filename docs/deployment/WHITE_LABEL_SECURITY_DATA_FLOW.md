# White-label security and data flow

This is an operator-oriented map of the current application boundary, not a security
certification, deployment assessment, or promise about a particular hosting provider.
It supplements [Whitelabeling](../WHITELABELING.md) and
[Self-hosting](./SELF_HOSTING.md).

## Status: verified versus assumed

**Verified in this repository:** the application uses PostgreSQL through Prisma; browser
and native clients communicate with this web/API deployment; API authentication accepts
session cookies and OAuth access tokens; selected credential fields use field-level
encryption; storage, email, authentication, and AI-provider integrations are configurable.
Evidence is cited in the tables below.

**Assumptions to verify for each deployment:** provider contracts, data residency, provider
retention, backup encryption, log access and retention, network controls, key custody,
identity lifecycle, and any legal or regulatory requirements. The repository does not
establish those properties for infrastructure an operator chooses.

## Deployment and tenant boundary

| Area | Verified behavior | Operator implication | Evidence |
|---|---|---|---|
| Tenant isolation | The documented boundary is one customer organization per deployment, with its own database and keys. Shared multi-organization tenancy, per-organization IdPs, SCIM, and session revocation are not shipped. | Run a separate deployment, database, and secret set per organization that requires isolation. Do not treat a shared deployment as tenant-isolated. | `docs/WHITELABELING.md` → “Deployment and tenancy boundary”; `docs/deployment/AZURE.md` → “Per-tenant keys” |
| Application records | The Prisma schema defines models for users, OAuth accounts, sessions, task lists, tasks, comments, events, and notifications. | PostgreSQL contains customer application records; protect it as customer data and include it in backup and access-control plans. | `prisma/schema.prisma` (`User`, `Account`, `Session`, `TaskList`, `Task`, `Comment`, `TaskEvent`, `Notification`) |
| Uploads | The object-storage layer supports Vercel Blob, S3-compatible, local, and Azure Blob drivers; private objects are served through application routes or provider-specific signed access. | Choose and secure the storage provider; back up uploaded objects separately from PostgreSQL. | `lib/env.ts` (`STORAGE_DRIVER`); `lib/storage/object-store.ts`; `docs/deployment/SELF_HOSTING.md` → “How uploads work off Vercel” |
| Authentication | The web auth configuration uses JWT sessions with a 30-day max age and secure cookies when HTTPS is used. API auth accepts OAuth tokens and session cookies; deployment-level SSO is one OIDC issuer. | Configure and test your own IdP applications. IdP account removal alone does not provide session revocation; the guide describes that lifecycle capability as partner-built. | `lib/auth-config.ts`; `lib/api-auth-middleware.ts`; `docs/WHITELABELING.md` → “Deployment and tenancy boundary” |
| Credentials at rest | `ENCRYPTION_KEY` is required; `lib/field-encryption.ts` uses AES-256-GCM for selected sensitive fields. This is not whole-database encryption. | Keep the key separately in a secret manager and back it up with restricted access. Losing it makes encrypted fields unrecoverable. | `lib/env.ts` (`ENCRYPTION_KEY`); `lib/field-encryption.ts`; `docs/deployment/SELF_HOSTING.md` → “Settings” |

## Data flows and third-party recipients

Which optional integrations are active depends on the deployment profile and runtime
configuration. The table describes the configured path; it does not assert that every
deployment enables every integration.

| Flow | Data handled or sent | Recipient / control point | Evidence |
|---|---|---|---|
| Client ↔ application | Authenticated API requests and application records; native clients use the same web API. | The deployment's public HTTPS origin and its own database. | `ASTRID.md` → “Project Overview”; `docs/API_CONTRACT.md`; `app/api/v1/` |
| Sign-in | Provider identity and token material returned during authentication; supported providers are enabled by brand capabilities and credentials. | The configured OIDC/OAuth identity provider and this deployment. | `lib/auth-config.ts`; `lib/env.ts` (`GOOGLE_CLIENT_SECRET`, `AUTH_SSO_*`); `docs/WHITELABELING.md` → “Sign-in providers” |
| AI execution | User/task context and prompts needed by the selected server-run provider. User API credentials are stored in user settings and encrypted at rest; provider calls use configurable endpoints. | The configured AI provider or compatible endpoint, only when that execution path is enabled. | `lib/env.ts` (AI settings and provider base URLs); `lib/ai/agent-execution-mode.ts`; `lib/ai/clients/` |
| GitHub integrations | Requests and event payloads needed by enabled GitHub integrations and repository workflows. | GitHub, using the deployment's configured GitHub app/OAuth credentials. | `lib/github-client.ts`; `lib/env.ts` (`GITHUB_CLIENT_SECRET`); `docs/ARCHITECTURE.md` → “GitHub Integration” |
| Outbound email | Recipient address and message content for configured email features. | The selected Resend or SMTP relay; `EMAIL_TRANSPORT=log` logs instead of sending. | `lib/env.ts` (`EMAIL_TRANSPORT`, `RESEND_API_KEY`, `SMTP_*`); `lib/email.ts` |
| Upload storage | Uploaded object bytes and storage metadata. | The configured blob, S3-compatible, or local storage destination. | `lib/env.ts` (`STORAGE_DRIVER`); `lib/storage/object-store.ts`; `docs/deployment/SELF_HOSTING.md` |
| Realtime and rate-limit services | Realtime events and rate-limit/cache state, depending on selected backend. | Redis, Upstash, or deployment-local memory as configured. | `lib/env.ts` (`REALTIME_BUS`, `REDIS_URL`, `UPSTASH_REDIS_REST_*`); `lib/realtime/bus.ts`; `lib/rate-limiter.ts` |
| Operational logs | Structured application log records are written to the configured process output; the hosting platform determines where they are collected. | The deployment operator's logging platform. | `lib/logger.ts`; `docs/deployment/AZURE.md` → “Logs and traces” |

## Sessions, secrets, and access

- `NEXTAUTH_SECRET` signs JWT sessions and WebAuthn state; the configured JWT session
  lifetime is 30 days. Rotating that key signs users out (`lib/env.ts`,
  `lib/auth-config.ts`).
- OAuth access tokens are validated by the API middleware; browser and native session
  cookies are another supported API identity (`lib/api-auth-middleware.ts`). Use
  `X-OAuth-Token` for the OAuth API contract, not a bearer token in a URL
  (`docs/API_CONTRACT.md`).
- Put runtime credentials in the host's secret manager. Keep them out of source control,
  brand profiles, build logs, image layers, and support tickets. Brand profile `env` is
  applied to build configuration; it is not a secret store (`lib/brand/profile.ts`,
  `scripts/brand-env-file.ts`).
- `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `CRON_SECRET`, database credentials, and provider
  credentials have different purposes; do not reuse them across deployments
  (`lib/env.ts`, `docs/deployment/AZURE.md` → “Per-tenant keys”).
- Configure server and database access using least privilege. Verify that only intended
  staff can access production data, secrets, backups, logs, and administrative routes;
  the repository does not configure your cloud IAM roles for you.

## Audit and log retention

There is no single repository-defined retention promise for all audit and operational
logs. Application history tables have code-defined windows, but pruning is dry-run unless
`HISTORY_RETENTION_PRUNE=delete` is explicitly set (`lib/history-retention.ts`,
`lib/history-retention-service.ts`). `WebhookDeliveryLog` records delivery identifiers,
target URL, status, response details, and error text; its Prisma model does not itself
declare a retention period (`prisma/schema.prisma`, `WebhookDeliveryLog`).

The host controls process-log retention. The application logger redacts selected
credential-shaped fields, which is not a guarantee that every personal or customer value
is removed (`lib/logger.ts`). Before production, decide and document database-history,
webhook-log, backup, and infrastructure-log retention and deletion procedures.

## Assumptions and open decision

- The deployment operator controls the cloud accounts, secret manager, identity
  applications, database, object storage, and log workspace it configures.
- Provider data handling and residency are governed by those providers' terms and the
  operator's configuration; they have not been independently verified here.
- This document makes no SOC 2, ISO 27001, HIPAA, FedRAMP, or other certification claim.

TODO(Jon): decision — What audit, application-history, backup, and infrastructure-log
retention policy should the corporate readiness pack require?
