# Self-hosting

How a company runs Astrid, or its own white-labelled brand of it, on its own
infrastructure: no Vercel, Neon or Upstash account. Task
[AWTD-1286](https://astrid.cc/t/AWTD-1286).

Branding is a separate topic: [WHITELABELING.md](../WHITELABELING.md). This page covers
running what you have branded.

---

## What you are running

**One server.** The web app *is* the API. The web, iOS, Mac, Windows and Android apps all
sign in to it and sync through it (`/api/v1`). None of them talks to anything else. So
self-hosting the product means self-hosting this one image.

| Piece | Hosted Astrid (Vercel) | Self-hosted |
|---|---|---|
| App and API | Vercel functions | The Docker image: one Node process (`next start`, standalone) |
| Database | Neon Postgres | Any PostgreSQL. The compose file runs `postgres:17` |
| Migrations | Applied by the production deploy | The `migrate` service, before every start of a new version |
| Scheduled jobs | Vercel Cron, from `vercel.json` | The `cron` service (`scripts/cron-runner.mjs`) reads the same `vercel.json` |
| Background jobs (Astrid replies, retries) | `after()` and the minute cron drain the `Job` table | The same, plus the `worker` service (`scripts/job-worker.mjs`) draining every 10 s |
| Uploads | Vercel Blob | `STORAGE_DRIVER=local` (a volume), `s3` (AWS S3, MinIO, R2, Ceph) or `azure-blob` |
| Outbound email | Resend | `EMAIL_TRANSPORT=smtp`: any SMTP relay (Azure Communication Services, SendGrid, Exchange Online, your own); or Resend |
| Cache and rate limits | Upstash Redis | `REDIS_URL` (compose runs `redis:7`); optional |
| Real-time updates (SSE) | Upstash, shared across instances (`REALTIME_BUS=upstash`, the default) | Redis pub/sub over `REDIS_URL` (`REALTIME_BUS=redis`, set by compose), shared across replicas |
| TLS | Vercel | Your proxy, or `--profile tls` (Caddy, automatic certificates) |
| Web analytics | Vercel Analytics | Off: the components render only on Vercel |

Nothing else is required. Email (SMTP or Resend), web push (VAPID), Google, Apple and GitHub
sign-in, the GitHub integrations and AI providers are all optional, each configured the
same way as on hosted Astrid.

## Quick start

You need Docker with Compose v2, a DNS name pointing at the machine, and ports 80 and 443
open. The build has been run in an 8 GB Docker VM and produces an image of about 750 MB.
Idle, the whole stack uses under 300 MB: the app about 150 MB, Postgres about 80 MB, and
cron and Redis the rest. Size the machine for your traffic, not for those figures.

```bash
git clone https://github.com/Graceful-Tools/astrid-web && cd astrid-web
cp deploy/self-host/.env.example deploy/self-host/.env
# Edit deploy/self-host/.env: BRAND, NEXTAUTH_URL, the four secrets, SITE_DOMAIN.
docker compose -f deploy/self-host/docker-compose.yml --profile tls up -d --build
```

Then:

1. Open `https://<your domain>` and create the first account with a passkey. Passkeys
   need nothing configured.
2. Check that it is healthy. `GET /api/health` reports `healthy` and the commit you built,
   and `GET /api/v1/capabilities` reports your brand and sign-in methods.
3. Run the smoke test against it. It checks pages, the API, cron authentication and an
   upload round-trip:

   ```bash
   set -a; . deploy/self-host/.env; set +a
   SMOKE_BASE_URL=https://<your domain> npx tsx scripts/self-host-smoke.ts
   ```

The same stack runs in CI on every change to the image (`.github/workflows/self-host.yml`).

## Your brand: mounted at runtime, or built in

**One image serves any brand** (AWTD-1587). The image reads every brand value when it
starts, `NEXT_PUBLIC_*` included. To brand the published image, mount your profile and,
optionally, a directory of artwork. `deploy/self-host/docker-compose.yml` carries the
volume commented out under the `app` service:

```yaml
    volumes:
      - ./brand:/brand:ro            # acme.brand.json, plus assets/ with your logo and icon
```

Uncomment it, put your files in `deploy/self-host/brand/`, and set the paths in `.env`:

```bash
BRAND_PROFILE=/brand/acme.brand.json
BRAND_ASSETS_DIR=/brand/assets
```

In the profile, refer to mounted artwork as `/brand-assets/<file>`. For example, set
`"assets": { "icon": "/brand-assets/acme-1024.png" }` and
`NEXT_PUBLIC_BRAND_LOGO: "/brand-assets/acme-logo.png"`. Every icon size is generated from
that one icon. Changing the brand means a restart, not a rebuild.

Precedence at start is:
1. a variable set in the environment file;
2. the mounted profile;
3. the profile the image was built with.

Run `npm run check:brands` on a profile before mounting it. The container checks only the
profile's shape, not every key. It also runs the build's identity check on what it applied
(AWTD-1606): any identity value the profile leaves on Astrid's (the support email, the URL
scheme, the GitHub App…) is named in the app's log at start. It is a warning only; list the
ones you keep on purpose in `BRAND_INHERIT_ASTRID_IDENTITY`.

CI proves this path on every change to the image (`.github/workflows/self-host.yml`): it
builds with no brand, mounts `brands/acme.brand.json` with its artwork moved to the mounted
directory, and the smoke test checks that pages, manifest and icons are Acme's. To run the
same brand checks against your deployment, add
`SMOKE_BRAND_PROFILE=path/to/your.brand.json` (and `SMOKE_BRAND_ASSETS_DIR`) to the smoke
command in *Quick start*.

The image renders pages per request, because that is what lets the brand change without a
rebuild. It sets `ASTRID_RUNTIME_BRAND=true` itself. Hosted Astrid does not set it, so
Astrid's pages stay prerendered.

You can still build a brand in:

```bash
docker build --build-arg BRAND=acme --build-arg GIT_COMMIT_SHA=$(git rev-parse HEAD) -t tasks .
```

`BRAND` is a profile in `brands/`, or a path to one inside the checkout. It becomes the
image's default brand: the lowest step in the precedence list above.

Values that are not brand identity are read at runtime as they always were. Set them in
the environment file: secrets, provider credentials, `BRAND_ENABLED_AGENTS` and the like.

The one compiled-in value that is not brand identity is `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, for
web push. It is a build argument.

## Settings

The full registry, with a description of every variable: `npm run check:env`, or
`lib/env.ts`.

**Required:**

| Variable | |
|---|---|
| `NEXTAUTH_URL` | The public origin, `https://…`. Sign-in callbacks and every absolute link derive from it, including stored upload URLs |
| `NEXTAUTH_SECRET` | Signs sessions and upload grants. Rotating it signs everyone out |
| `ENCRYPTION_KEY` | Encrypts stored credentials. Exactly 64 hex characters (`openssl rand -hex 32`). **Back it up with the database**: without it, those rows cannot be read |
| `CRON_SECRET` | The cron service sends it. Every cron route refuses requests without it |
| `POSTGRES_PASSWORD` | For the bundled Postgres. With your own database, set `DATABASE_URL` and `DATABASE_URL_DIRECT` instead (see *Your own database*) |

**Storage:**

| `STORAGE_DRIVER` | Needs | Use |
|---|---|---|
| `local` | A persistent volume at `STORAGE_LOCAL_DIR` (compose mounts `uploads`) | One server |
| `s3` | `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_REGION` or `S3_ENDPOINT` | Anything with more than one server, or managed durability |
| `azure-blob` | `AZURE_STORAGE_CONTAINER`, and `AZURE_STORAGE_CONNECTION_STRING` or `AZURE_STORAGE_ACCOUNT` (Managed Identity) | Azure. Blob does not speak S3 |
| `vercel-blob` | `BLOB_STORE_ID` with OIDC on Vercel; `BLOB_READ_WRITE_TOKEN` anywhere else | The default. Hosted Astrid only |

With `s3` and any of its settings missing, the server logs their names at start
(`STORAGE_DRIVER=s3 is missing: …`) and answers every request with a 500. Its health check
fails, so `docker compose up --wait` and an orchestrator's readiness probe report it.
Nothing gets stored in the wrong place in the meantime.
The bucket stays private. The app reads objects with its own credentials and serves them
at `/api/v1/storage/objects/…`, so you need no bucket policy, public access or CORS rule.

With `azure-blob`, create the container first; it stays private as well. With a connection
string the app signs with the account key. With only `AZURE_STORAGE_ACCOUNT` it signs in
with `DefaultAzureCredential`, which on Container Apps or App Service is the managed
identity. Give that identity **Storage Blob Data Contributor** on the container and
**Storage Blob Delegator** on the account. After `/api/secure-files/:id` has checked access,
it redirects to a five-minute, read-only SAS URL (a user-delegation SAS under managed
identity), so file bytes come from Azure instead of passing through the app. To try it
locally, `--profile azure` runs [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite).

**Email:**

| `EMAIL_TRANSPORT` | Needs | Use |
|---|---|---|
| `resend` | `RESEND_API_KEY` (without it, messages are logged instead of sent) | The default. Hosted Astrid |
| `smtp` | `SMTP_URL` (`smtp://user:pass@host:587`, or `smtps://…:465`), or `SMTP_HOST` with optional `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE=true` | Any SMTP relay |
| `log` | Nothing | Never send; log what would have been sent |

`FROM_EMAIL` is the sender for all of them, and your relay must be allowed to send as it.
With `smtp` and no relay configured, the server refuses to start (`EMAIL_TRANSPORT=smtp is
missing: SMTP_URL (or SMTP_HOST)`), in the same way as half-configured storage. To try it
locally, `--profile mail` runs [mailpit](https://mailpit.axllent.org), a sink that keeps
everything it receives: set `EMAIL_TRANSPORT=smtp` and `SMTP_URL=smtp://mailpit:1025`, then
read the inbox at `http://localhost:8025`. Inbound email-to-task still uses webhooks, as
on hosted Astrid.

**Behind a proxy:** set `TRUSTED_PROXY_DEPTH` to the number of proxies in front of the app
(1 with `--profile tls`). Rate limits are keyed on the client address the proxy forwards.
With the wrong depth, a caller chooses their own key.

## How uploads work off Vercel

The clients did not change. When a native app uploads a large file, it asks
`get-upload-url` for a presigned request and PUTs the bytes to whatever URL comes back.
On Vercel that URL is Blob's, and Blob calls the app back once the bytes land. Self-hosted,
the URL is the app's own `/api/v1/storage/uploads/<grant>`, which stores the bytes and
records the file itself. The grant is signed with `NEXTAUTH_SECRET`, expires after an hour,
and allows one path, its content types and a maximum size.

Objects are served the way Blob serves them: anyone with the URL can read the file, and
the URLs cannot be guessed. Permission checks happen at `/api/secure-files/:id`, which
redirects only after checking. One difference is deliberate. Blob serves files from its
own domain, while these come from the app's. So every object response is sandboxed with
`Content-Security-Policy: sandbox` and `nosniff`. Anything that is not media, a PDF or
plain text is sent as a download, so an uploaded HTML file cannot run as your site.

## Scheduled jobs

The `cron` service calls each route listed in `vercel.json` `crons`, on that schedule, in
UTC, with `Authorization: Bearer $CRON_SECRET`. Each job's result is a JSON line in
`docker compose logs cron`. Run **exactly one** runner. Two would run every job twice. A job
still running when it comes due again is skipped.

To use your own scheduler instead, such as system cron or a Kubernetes CronJob, generate
its entries from the same file:

```bash
CRON_BASE_URL=https://tasks.example.com node scripts/cron-runner.mjs --print-crontab
```

The image has no curl, so a scheduler that starts the image itself for each run (a
Kubernetes CronJob, an Azure Container Apps Job) uses `--run` instead. It calls one route
once and exits non-zero if the route failed:

```bash
node scripts/cron-runner.mjs --run /api/cron/reminders
```

## Published images

Releases are published to GHCR by `.github/workflows/release-image.yml` (AWTD-1464). Each
release is a pair of images:

| Image | What it is |
|---|---|
| `ghcr.io/graceful-tools/astrid-web:<version>` | The app (also runs the cron runner) |
| `ghcr.io/graceful-tools/astrid-web:<version>-migrator` | `prisma migrate deploy`, run before the app |

`<version>` is a semver release such as `1.4.0`. Each image carries an SBOM and a
provenance attestation (`docker buildx imagetools inspect <image> --format '{{json .SBOM}}'`).
`:edge` is the latest build of `main`, published only when someone runs the workflow by
hand. Do not run it in production.

The published images are built with **Astrid's default brand**, and they take any brand at
runtime ([Your brand](#your-brand-mounted-at-runtime-or-built-in)). A partner does not need
an image of its own.

To run a published release instead of building, set the image in `deploy/self-host/.env`:

```bash
IMAGE=ghcr.io/graceful-tools/astrid-web
IMAGE_TAG=1.4.0
```

Then pull and start without `--build`:

```bash
docker compose -f deploy/self-host/docker-compose.yml pull migrate app
docker compose -f deploy/self-host/docker-compose.yml up -d --no-build
```

### Releases

Releases are semver tags (`v1.4.0`) cut by hand from `main`, with `CHANGELOG.md` as the
release notes. A tag triggers the workflow. The workflow then pulls the pair it just
published and runs the smoke test against it, with nothing built locally. A major version
means the upgrade needs something beyond the steps below, and the changelog says what.

## Upgrades

**Back up the database first.** Then:

1. **Pull the new tag.** Set `IMAGE_TAG` to the new version and run
   `docker compose -f deploy/self-host/docker-compose.yml pull migrate app`.
   If you build from source instead, `git pull` (or check out the tag).
2. **Run the migrator.** `migrate` runs `prisma migrate deploy` and must succeed before
   the new app container starts. Compose does this for you on `up`. On Kubernetes, run
   the `-migrator` image as a Job before the rollout.
3. **Roll the app.** `docker compose -f deploy/self-host/docker-compose.yml up -d --no-build`
   (or `up -d --build` from source).

A migration that removes something is written to take two releases, so the previous
release keeps working against the migrated database while you roll.

**Downgrades: migrations are forward-only.** There are no down migrations. Going back a
release with the migrated database is safe only when the release notes say the migration
was additive. Otherwise the only undo is restoring the backup taken in step 1, together
with the older tag.

Back up three things: the Postgres volume (or your database), the uploads volume or
bucket, and `ENCRYPTION_KEY`.

## Your own database, Kubernetes, and other platforms

The image is an ordinary OCI image, and compose is one way to run it.

- **Your own Postgres.** Drop the `postgres` service and set `DATABASE_URL` (pooled, if you
  run a pooler) and `DATABASE_URL_DIRECT` (direct; migrations use it).
- **Kubernetes.**
  - Run `migrate` (`--target migrator`) as a Job before each rollout.
  - Run the app as a Deployment with a readiness probe on `/api/health`.
  - Run the runner as a one-replica Deployment with `command: node scripts/cron-runner.mjs`,
    or generate CronJobs from `--print-crontab`.
  - Run the job worker as a Deployment with `command: node scripts/job-worker.mjs`. Any
    number of replicas is safe (each job is claimed once); one is enough.
- **More than one app replica** needs three things:
  - `STORAGE_DRIVER=s3`, because a local volume is per pod.
  - Exactly one cron runner.
  - `REALTIME_BUS=redis` and a `REDIS_URL` every replica can reach, for real-time updates
    across replicas (compose sets both). Events go out over Redis pub/sub, one channel per
    user, and a per-user sorted set keeps the last 15 minutes for clients that reconnect.
    `REALTIME_BUS=upstash` with `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` also
    works, but it polls every 15 s. See `lib/realtime/bus.ts`. A single replica needs none
    of this.

## Azure

`deploy/azure/main.bicep` runs this image on Azure Container Apps with Postgres Flexible
Server, Azure Cache for Redis, Blob Storage and Key Vault, from one parameters file per
brand. Guide: [AZURE.md](./AZURE.md).

## Pointing the native apps at it

The apps take their server from the brand profile's domain when they are built (iOS/Mac:
`make-brand-variant.sh`, Windows: `package.ps1 -Brand`, Android: `brand.properties`).
**Settle the domain before building them.** Release builds cannot switch servers. The
steps per platform, the URL-scheme rule for native sign-in, and `BRAND_APPLE_APP_IDS` for
universal links are in [WHITELABELING.md](../WHITELABELING.md), *Native apps, per platform*.

## Known limits

- **Only one SSO provider (OIDC) per deployment.** Per-organisation SSO is a partner build:
  WHITELABELING §3.
- **The image builds on linux/amd64 and linux/arm64.** CI exercises amd64.
- **Default-locale paths do not redirect-loop in the image.** A standalone `next start`
  run from a checkout and reached as `localhost` was seen to 307-loop on `/terms` and
  `/en/terms`. The container does not (AWTD-1606): `/terms` answers 200, and `/en/terms`
  redirects once to `/terms`. The smoke test follows both, hop by hop, on every image change.
