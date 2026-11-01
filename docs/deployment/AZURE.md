# Running Astrid on Azure

How a partner runs Astrid, or its own white-labelled brand of it, in its own Azure
subscription. Task [AWTD-1468](https://astrid.cc/t/AWTD-1468).

This page assumes you have read [SELF_HOSTING.md](./SELF_HOSTING.md), which covers what the
image is and how its settings work. On Azure the same image runs on Container Apps, with
Azure's managed services in place of the compose file's containers. The template is
[`deploy/azure/main.bicep`](../../deploy/azure/main.bicep). Each brand has a parameters
file next to it, and [`whitelabel-partner.bicepparam`](../../deploy/azure/whitelabel-partner.bicepparam)
is the one to copy.

> **Status:** the template compiles and lints clean with the Bicep CLI, and a test pins
> every setting it names against the app's registry (`lib/env.ts`). It has **not yet
> been deployed to a real subscription**. The first person to run it should report
> anything below that turned out to be wrong.

---

## What gets created

One resource group per brand (or per tenant: see [Per-tenant keys](#per-tenant-keys)).

| Resource | Role | Replaces (compose) |
|---|---|---|
| Container Apps environment, in a VNet | Runs everything below | Docker |
| `<name>-app` Container App | The web app and API. Minimum one replica, scales on concurrent requests | `app` |
| `<name>-migrator` Container Apps Job | `prisma migrate deploy`, started by hand before every roll | `migrate` |
| `<name>-cron-*` Container Apps Jobs | One scheduled Job per entry in `vercel.json` `crons` | `cron` |
| `<name>-worker` Container App | The durable-job worker. **Off by default** (see [Worker](#the-worker)) | — |
| PostgreSQL Flexible Server | Private access only (delegated subnet), built-in PgBouncer | `postgres` |
| Azure Cache for Redis | Realtime bus and cache, TLS only | `redis` |
| Storage account + `uploads` container | `STORAGE_DRIVER=azure-blob`, through the managed identity | `uploads` volume |
| Key Vault | Every secret the containers read, by reference | `.env` |
| User-assigned managed identity | Reads Key Vault, reads and writes Blob, can pull from ACR | — |
| Log Analytics + Application Insights | Console logs, and traces | `docker compose logs` |

The settings that wire these together are set by the template, so you don't write them:
`DATABASE_URL` (the pooler, port 6432), `DATABASE_URL_DIRECT` (port 5432, for
migrations), `REDIS_URL`, `REALTIME_BUS=redis`, `STORAGE_DRIVER=azure-blob`,
`AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER`, `AZURE_CLIENT_ID`, `NEXTAUTH_URL`,
`TRUSTED_PROXY_DEPTH` and `OTEL_SERVICE_NAME`.

## Before you start

- An Azure subscription, and **Owner** (or Contributor plus User Access Administrator)
  on a resource group. The template creates role assignments.
- The [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), signed in
  (`az login`). It includes Bicep.
- A container registry you can push to. Azure Container Registry is the simplest.
- An SMTP relay for email: Azure Communication Services Email has SMTP. Any relay works.
- The brand profile, settled: `brands/<brand>.brand.json` ([WHITELABELING.md](../WHITELABELING.md)).
  Its domain is compiled into the image and into the native apps.

## 1. Images

One image is one brand: the brand's name, colours, domain and sign-in providers are
compiled in ([SELF_HOSTING.md](./SELF_HOSTING.md#your-brand-goes-in-at-build-time)). Build
yours in Azure from a checkout of the release tag, with no local Docker needed:

```bash
git checkout v1.4.0
az acr build -r <registry> -t tasks:1.4.0 \
  --build-arg BRAND=whitelabel-partner \
  --build-arg GIT_COMMIT_SHA=$(git rev-parse HEAD) \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY=<your VAPID public key, or empty> .
az acr build -r <registry> -t tasks:1.4.0-migrator --target migrator .
```

`GIT_COMMIT_SHA` is what `GET /api/health` reports as `commitSha`. It is how you confirm
which build is serving after an upgrade. Without it, health reports `unknown`.

The migrator image does not depend on the brand. The published
`ghcr.io/graceful-tools/astrid-web:<version>-migrator` works as well as your own build of it.

**Registry access.** For a private registry, set `REGISTRY_SERVER` with a
repository-scoped token in `REGISTRY_USERNAME` / `REGISTRY_PASSWORD`. You can use the
managed identity instead (`REGISTRY_SERVER` alone). In that case the first deployment
fails at the app: the identity it creates has no `AcrPull` yet. Grant `AcrPull` on the
registry to the `<name>-identity` principal, then run the deployment again.

## 2. Secrets

Generate these once per deployment and keep them in your own secret store. The parameters
file reads them from the environment when you deploy, so none is ever written to a file:

```bash
export NEXTAUTH_SECRET=$(openssl rand -base64 48)
export ENCRYPTION_KEY=$(openssl rand -base64 48)
export CRON_SECRET=$(openssl rand -base64 32)
export POSTGRES_ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')
npx web-push generate-vapid-keys   # → VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, for web push
```

**Export the same values for every deployment.** The template writes each one to Key Vault
on every run, so a new value replaces the old one:

- A new `ENCRYPTION_KEY` makes every stored credential unreadable. To change it, use the
  rotation in `scripts/reencrypt-fields.ts` (`ENCRYPTION_KEY_NEXT`), never a redeploy.
- A new `NEXTAUTH_SECRET` signs everyone out.
- A new `POSTGRES_ADMIN_PASSWORD` changes the database password, and the connection
  strings with it.

A missing required secret fails the deployment before anything changes. An optional one
left empty (`SMTP_URL`, `AUTH_SSO_CLIENT_SECRET` …) is not set, and the feature that needs
it is off.

Key Vault has purge protection on. A deleted vault, and the `ENCRYPTION_KEY` in it, can be
recovered for 90 days. Keep your own copy as well.

## 3. Deploy

```bash
az group create -n tasks-wlp -l westeurope
export APP_IMAGE=<registry>.azurecr.io/tasks:1.4.0
export MIGRATOR_IMAGE=<registry>.azurecr.io/tasks:1.4.0-migrator
export SMTP_URL='smtp://<user>:<pass>@smtp.azurecomm.net:587'
az deployment group create -g tasks-wlp \
  -f deploy/azure/main.bicep -p deploy/azure/whitelabel-partner.bicepparam
```

The first run takes 15 to 25 minutes. Postgres and Redis take the longest. Then run the
migrations, which create the schema:

```bash
az containerapp job start -g tasks-wlp -n wlp-migrator
az containerapp job execution list -g tasks-wlp -n wlp-migrator -o table   # wait for Succeeded
```

Until that succeeds, the app's readiness probe fails and it serves nothing. That is
expected on a first deployment.

Check it, using the `appUrl` output:

```bash
curl https://<appUrl>/api/health            # "healthy", and your commit
curl https://<appUrl>/api/v1/capabilities   # your brand and sign-in methods
SMOKE_BASE_URL=https://<appUrl> npx tsx scripts/self-host-smoke.ts   # NEXTAUTH_SECRET, CRON_SECRET exported
```

If the first run fails with a Key Vault access error on a container app, the identity's
role assignment had not propagated yet. Run the same command again.

The parameters file sets `EMAIL_TRANSPORT=smtp`. **Without `SMTP_URL` the app refuses to
start**, and the log names the missing setting. That is deliberate: it is better than
silently not sending email. To deploy without email, set `EMAIL_TRANSPORT` to `log` in the
brand's parameters file.

## 4. Custom domain and certificate

A managed certificate can only be issued for a hostname that is already on the app. So
this takes three passes, each the same `az deployment group create` with one more
variable:

1. Deploy without `CUSTOM_DOMAIN`. Note the outputs `appFqdn` and
   `customDomainVerificationId`.
2. At your DNS provider, create:
   - `CNAME tasks.partner.example` → `appFqdn`
   - `TXT asuid.tasks.partner.example` → `customDomainVerificationId`
3. `export CUSTOM_DOMAIN=tasks.partner.example` and deploy. The hostname is added, unbound.
   `NEXTAUTH_URL` now uses it.
4. `export BIND_MANAGED_CERTIFICATE=true` and deploy. The certificate is issued (a few
   minutes) and bound. It renews itself.

Then register `https://tasks.partner.example/api/auth/callback/<provider>` with each
sign-in provider. Keep `CUSTOM_DOMAIN` and `BIND_MANAGED_CERTIFICATE` exported for every
later deployment, or the binding is removed.

**Behind Front Door or Application Gateway** the custom domain and its certificate belong
on the proxy, not the app. Leave `CUSTOM_DOMAIN` empty. Point the proxy's origin at
`appFqdn` with the origin host header set to `appFqdn`. Set `NEXTAUTH_URL` to the public
origin in the brand file's `appSettings`; that value overrides the template's.

## 5. Behind a proxy: `TRUSTED_PROXY_DEPTH`

Rate limits are keyed on the client address, read from `X-Forwarded-For` counting from the
right (`lib/client-ip.ts`). Container Apps ingress appends the address it saw. Every proxy
in front of it adds one more hop:

| In front of the app | `TRUSTED_PROXY_DEPTH` |
|---|---|
| Nothing: clients reach Container Apps directly | `1` (the default) |
| Front Door, **or** Application Gateway | `2` |
| Front Door **and** Application Gateway | `3` |

Too low and every user shares the proxy's address and one rate limit. Too high and a
caller chooses their own key by sending a forged `X-Forwarded-For`.

The depth is only meaningful if the proxy is the **only** way in. Otherwise a caller who
goes straight to `appFqdn` has one fewer hop, and the forged entry counts as trusted. Set
`ingressAllowedCidrs` to the proxy's egress ranges (for Front Door, the address ranges of the
`AzureFrontDoor.Backend` service tag, from Azure's published service-tag list). The cron Jobs call the app through the same
ingress, so also allow the environment's outbound addresses. Find them in the portal,
under the environment's *Networking*, or the cron routes are refused. An operator who
needs no public ingress at all can use an internal environment with Front Door Premium
Private Link. This template does not build that.

## 6. Sign-in with Entra ID

Entra ID is the deployment's `sso` provider: one OIDC issuer for the whole deployment
([WHITELABELING.md](../WHITELABELING.md), *Sign-in providers*).

1. **The brand must list it.** `NEXT_PUBLIC_BRAND_AUTH_PROVIDERS` in the brand profile
   includes `sso` (e.g. `"sso,passkey"`). This is compiled in, so changing it means
   rebuilding the image.
2. **Register an app in Entra ID** (Microsoft Entra admin center, *App registrations*):
   - Supported account types: **this organisational directory only** (single tenant).
   - Redirect URI, platform **Web**: `https://<your domain>/api/auth/callback/sso`.
   - *Certificates & secrets*: create a client secret. Note when it expires, because sign-in
     stops on that date.
   - *Token configuration*: add the optional claim **`email`** to the **ID** token. v2.0
     tokens leave it out otherwise, and a user with no email cannot be linked.
3. **Set the four settings** (exported before deploying; the parameters file passes them on):

   ```bash
   export AUTH_SSO_ISSUER=https://login.microsoftonline.com/<tenant id>/v2.0
   export AUTH_SSO_CLIENT_ID=<application (client) id>
   export AUTH_SSO_CLIENT_SECRET=<the client secret>       # becomes a Key Vault secret
   export AUTH_SSO_DOMAINS=partner.example,partner.co.uk  # the email domains Entra may vouch for
   ```

   Use the tenant id, never `common` or `organizations`. Then the issuer in every token is
   your own directory's.

**Who can sign in.** The app trusts an Entra identity for an email in `AUTH_SSO_DOMAINS`
and nothing else. It does not read group claims, so restrict access in Entra instead: on
the app's *Enterprise application*, set **Assignment required** to *Yes* and assign the
groups that should have access. You don't need to emit group claims. To use groups inside
the app as organisations, see *Per-organisation SSO* in WHITELABELING.md, which is a
partner build.

If any of the four settings is missing, the server refuses to start and names it.

## 7. Real-time updates

Live updates go over Redis pub/sub (`REALTIME_BUS=redis`), so an event raised on one
replica reaches clients connected to any other.

Container Apps ingress ends every HTTP request at **240 seconds**, and that limit cannot be
configured. The SSE stream sends a ping every 15 seconds. When the connection is cut, the
client reconnects and the bus replays the last 15 minutes, so nothing is lost. The same
happens at Vercel's 300-second function ceiling. Front Door and Application Gateway have
their own response timeouts. Keep them above the 15-second ping interval.

## 8. Scheduled jobs

Each entry in `vercel.json` `crons` becomes a scheduled Container Apps Job named
`<name>-cron-<route>`. The template reads `vercel.json` when it compiles, so a job added
there is deployed here on the next run. Times are UTC, as on Vercel. Each run starts a
container that calls its route once (`node scripts/cron-runner.mjs --run <path>`) and exits:

- 0 when the route answered, or answered 404 because a capability is off for this brand.
- 1 otherwise, so the execution shows as **Failed** in `az containerapp job execution list`.

Two jobs run every minute, so they start about 2,900 short containers a day. That is
normal for Container Apps Jobs, and you pay for seconds used. A run that is still going
when the next one is due is not skipped, which is also how Vercel behaves. If you would
rather run one always-on process, deploy the same image with
`node scripts/cron-runner.mjs` as a one-replica container app, and remove the cron Jobs.
Never run both, because every job would run twice.

## 9. The worker

`deployWorker` adds a `<name>-worker` container app running `node scripts/job-worker.mjs`.
That script drains the durable job table, which is being built in
[AWTD-1460](https://astrid.cc/t/AWTD-1460) and is **not yet in any release**. Leave
`deployWorker` false until the release notes say the image includes the worker. Until
then, the app drains jobs itself, as on Vercel.

## 10. Logs and traces

Console output from every container, the app's pino JSON included, goes to the Log
Analytics workspace `<name>-logs`:

```kusto
ContainerAppConsoleLogs_CL | where ContainerAppName_s == "wlp-app" | order by TimeGenerated desc
```

The app emits OpenTelemetry traces (`instrumentation.ts`). To send them to the
Application Insights the template created, switch on the environment's managed
OpenTelemetry agent. The template can't do it, because only a preview API version
supports it:

```bash
az containerapp env telemetry app-insights set -g tasks-wlp -n wlp-env \
  --connection-string "$(az monitor app-insights component show -g tasks-wlp --app wlp-insights --query connectionString -o tsv)" \
  --enable-open-telemetry-traces true
```

## Upgrades

Releases are semver tags. Read `CHANGELOG.md` for the version you are moving to first:
a major version means the upgrade needs something beyond these steps.

1. **Note the time.** Postgres keeps point-in-time backups (below), and this is the moment
   you would restore to.
2. **Build and push** the new pair of images ([Images](#1-images)).
3. **Migrate first.** Point the migrator at the new image and run it:

   ```bash
   az containerapp job update -g tasks-wlp -n wlp-migrator --image <registry>.azurecr.io/tasks:1.5.0-migrator
   az containerapp job start -g tasks-wlp -n wlp-migrator
   az containerapp job execution list -g tasks-wlp -n wlp-migrator -o table   # wait for Succeeded
   ```

   The running app keeps working against the migrated database: a migration that removes
   something is written to take two releases.
4. **Roll everything else.** Export the new `APP_IMAGE` and `MIGRATOR_IMAGE` and run the
   same `az deployment group create`. The app, the worker and the cron Jobs move to the
   new image. Container Apps starts the new revision and moves traffic once it is ready.
5. **Verify.** `GET /api/health` reports the new commit. Then run the smoke test.

**Going back.** Migrations are forward-only. Re-deploying the previous `APP_IMAGE` is safe
only when the release notes call that release's migration additive. Otherwise the undo is
a restore (below) together with the previous images.

## Backups and restore

| What | How it is kept | What you do |
|---|---|---|
| Database | Automatic backups with point-in-time restore, `postgresBackupRetentionDays` (7–35, default 14). Optionally geo-redundant (`postgresGeoRedundantBackup`, set at creation only) | Restore when needed (below) |
| Uploads | Zone-redundant storage. Deleted blobs and containers are kept for 14 days | Add a backup vault or object replication if you need more |
| Secrets | Key Vault, with soft delete and purge protection | **Keep your own copy of `ENCRYPTION_KEY`**. The database backup is useless without it |
| Redis | Not backed up | Nothing: a cache, plus a 15-minute replay window |

**Point-in-time restore** creates a new server. Restore it into the same subnet and DNS
zone, then adopt it by name:

```bash
az postgres flexible-server restore -g tasks-wlp \
  --source-server <postgresServerName output> --name wlp-pg-restored \
  --restore-time 2026-11-01T09:00:00Z \
  --subnet <the vnet's postgres subnet id> --private-dns-zone <the private DNS zone id>
export POSTGRES_SERVER_NAME=wlp-pg-restored
az deployment group create -g tasks-wlp -f deploy/azure/main.bicep -p deploy/azure/whitelabel-partner.bicepparam
```

The deployment rewrites the connection strings to the restored server and rolls the app.
Keep `POSTGRES_SERVER_NAME` exported from then on. Delete the old server once you are
sure.

## Per-tenant keys

Run one deployment, with one resource group, for each customer that must be isolated.
Each deployment gets its **own** `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `CRON_SECRET`,
Postgres password and VAPID key pair. Never copy them from another deployment:

- A shared `NEXTAUTH_SECRET` lets a session from one deployment be replayed on another.
- A shared `ENCRYPTION_KEY` means one leak exposes every tenant.

The VAPID public key is compiled into the image (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`), so
tenants with their own VAPID keys also need their own images.

## Networking

Postgres has no public endpoint: it is reachable only from the environment's subnet.
Redis and Storage keep their public endpoints. Both are TLS-only, Redis needs its access
key, and Storage accepts only Entra ID (shared keys are disabled). For private endpoints
on those two as well, add them to the VNet and turn off public network access. The app
needs no change, because the hostnames resolve to the private addresses.

Microsoft has announced that Azure Cache for Redis will retire in favour of Azure Managed
Redis. Check the current dates. Moving to Azure Managed Redis changes only `REDIS_URL`.

## What only hosted Astrid has (Vercel-only)

| Feature | On Azure |
|---|---|
| Preview deployments per branch, and Google sign-in bouncing through the brand domain on them | None. Every host signs in on itself ([WHITELABELING.md](../WHITELABELING.md)) |
| The MCP "list deployments" operation | Returns an empty list: it calls the Vercel API (`lib/vercel-client.ts`) |
| Vercel Analytics and Speed Insights | Off. The components render only on Vercel |
| Vercel Observability | Log Analytics and Application Insights ([Logs and traces](#10-logs-and-traces)) |
| Vercel Blob, Upstash, Neon, Resend | Replaced by Azure Blob, Azure Cache for Redis, Flexible Server and SMTP |
| `scripts/deploy-preview.sh` and the production-deployment workflow | Replaced by [Upgrades](#upgrades) |

## Still to do

The template has not yet been run against a real subscription. Before a partner relies on
it:

- `az deployment group create` from an empty subscription, with the partner brand.
- `scripts/self-host-smoke.ts` passes against it, including one email through the SMTP
  relay.
- Real-time events reach a client connected to the other replica (scale to two first).
- This page is read through by someone who has never seen the repository.
