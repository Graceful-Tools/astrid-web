# White-label launch checklist

Use this page as the operator's launch sequence. It links to the detailed guides rather
than replacing them. The supported boundary is one customer organization per deployment,
with its own database and keys; shared multi-organization tenancy and per-organization
identity lifecycle features are partner-built, not shipped. See [Project Mode](../product/PROJECT_MODE.md)
and [Whitelabeling](../WHITELABELING.md#deployment-and-tenancy-boundary).

## Status: verified versus assumed

**Verified in this repository:** brand profiles are applied at build time; `npm run
check:brands` tests the profiles in `brands/`; the app has a PostgreSQL schema, migrations,
selectable object-storage drivers, deployment-level authentication, and a health and
capabilities endpoint. Evidence: `lib/brand/profile.ts`, `scripts/brand-env-file.ts`,
`tests/brands/brand-matrix.test.ts`, `lib/env.ts`, `prisma/schema.prisma`, and
`app/api/health/route.ts`.

**Not verified for your environment:** your DNS, certificate, identity-provider
registration, secret store, database, storage durability, backup schedule, restore drill,
and release compatibility. Treat each as an operator check below. In particular, the
[Azure template has not been run against a real subscription](./AZURE.md#still-to-do).

## Required before first production use

- [ ] **Confirm the operating boundary and prerequisites.** Choose Vercel, Docker/Compose,
  Azure, or another supported OCI host; provision the account, permissions, network access,
  PostgreSQL, persistent upload storage, and a secret manager. One deployment serves one
  customer organization; it is not shared multi-organization tenancy. See
  [Self-hosting](./SELF_HOSTING.md), [Azure](./AZURE.md), and
  [Whitelabeling — deployment and tenancy boundary](../WHITELABELING.md#deployment-and-tenancy-boundary).
- [ ] **Settle the public domain, DNS, TLS, and callback origin.** Point DNS at the chosen
  host, enable HTTPS, set `NEXTAUTH_URL` to that public origin, and register the exact
  callback URLs with each selected identity provider. The app derives callbacks and
  absolute links from `NEXTAUTH_URL` (`lib/env.ts`, `lib/auth-config.ts`). See
  [Self-hosting](./SELF_HOSTING.md), [Azure — custom domain](./AZURE.md#4-custom-domain-and-certificate),
  or [Vercel setup](../setup/VERCEL_SETUP.md).
- [ ] **Prepare the brand profile.** Copy and edit a `brands/<name>.brand.json` profile.
  Keep its `env` values to brand/build configuration; do not put credentials or secrets in
  the profile. Apply the profile using the supported build path, then run
  `npm run check:brands`. `profileEnv()` applies the profile's `env` and optional copy block;
  `scripts/brand-env-file.ts` serializes that same result for Docker builds
  (`lib/brand/profile.ts`, `scripts/brand-env-file.ts`, `brands/README.md`).
- [ ] **Provision deployment-specific secrets.** Put required database URLs,
  `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, and `CRON_SECRET` in the deployment's secret manager;
  add only credentials for enabled providers, such as OAuth/OIDC, SMTP, storage, or push.
  Never commit secrets, bake them into an image, or reuse keys across organizations.
  `ENCRYPTION_KEY` is required to read encrypted credential fields; losing it is
  unrecoverable (`lib/env.ts`, `lib/field-encryption.ts`,
  [Azure — per-tenant keys](./AZURE.md#per-tenant-keys)).
- [ ] **Provision PostgreSQL and plan migrations.** Supply the pooled `DATABASE_URL` for
  runtime queries and direct `DATABASE_URL_DIRECT` for migrations. Take and verify a
  pre-upgrade backup. Apply only the matching release's migrator before rolling out its
  app image; migrations are forward-only, so do not assume an app-image rollback reverses
  a schema change (`lib/env.ts`, `.github/workflows/release-image.yml`,
  [Self-hosting — upgrades](./SELF_HOSTING.md#upgrades)).
- [ ] **Provision and test upload storage.** Select a supported driver, make the bucket,
  container, or volume private and persistent, and test an upload and authorized read-back.
  With multiple app replicas, local storage is not shared; use shared object storage.
  See `lib/env.ts`, [Self-hosting — storage](./SELF_HOSTING.md#settings), and
  [Azure](./AZURE.md).
- [ ] **Configure the first administrator deliberately.** Set `INITIAL_ADMIN_EMAIL` only
  for an address the operator controls and can verify. The app grants bootstrap admin
  after that user exists with a verified email; unset means no bootstrap admin
  (`lib/env.ts`, `lib/admin-auth.ts`). Order matters on a deployment that signs in only
  through a federated provider: while the setting names an address, a *new* provider
  identity with that address is refused (`lib/auth/federated-identity-linking.ts`), and
  the grant itself is applied by the analytics cron, not at sign-in
  (`app/api/cron/analytics/route.ts`). So create and verify the account first with the
  setting unset, then set it, then run or wait for that cron before checking admin
  access. Remove the bootstrap setting afterwards if your operating procedure calls for it.
- [ ] **Configure outbound mail and sign-in.** Register the chosen identity applications
  and callback URLs, and authorize the selected sender domain with the chosen mail relay.
  See [Whitelabeling — sign-in providers](../WHITELABELING.md#sign-in-providers),
  [Email Setup](../setup/EMAIL_SETUP.md), and
  [Self-hosting — email](./SELF_HOSTING.md#email).
- [ ] **Run the smoke test and record the release.** Confirm `GET /api/health` reports
  healthy and the expected commit, confirm `GET /api/v1/capabilities` reports the expected
  brand and enabled sign-in methods, then run
  [`scripts/self-host-smoke.ts`](../../scripts/self-host-smoke.ts) where applicable. Record
  the app and migrator image digests, commit, migration result, and client builds in the
  [compatibility matrix](./WHITE_LABEL_COMPATIBILITY.md).
- [ ] **Prove recovery and rollback before launch.** Complete a restore drill using the
  [backup and DR runbook](./WHITE_LABEL_BACKUP_DR.md). Roll back to a prior app image only
  when its release notes say its migration is compatible; otherwise restore the database
  and uploads with the prior image and encryption key. See
  [Self-hosting — upgrades](./SELF_HOSTING.md#upgrades) and
  [Azure — backups and restore](./AZURE.md#backups-and-restore).

## Optional or conditional setup

- [ ] **Web push:** configure the VAPID key pair only if browser push notifications are
  part of the launch. The public key is build-time configuration (`lib/env.ts`); see
  [Self-hosting](./SELF_HOSTING.md#your-brand-goes-in-at-build-time).
- [ ] **Native clients:** if shipping branded mobile or desktop apps, build and sign each
  platform variant for the settled domain. A release binary cannot switch servers.
  Follow [Whitelabeling — native apps](../WHITELABELING.md#native-apps-per-platform) and
  the [compatibility matrix](./WHITE_LABEL_COMPATIBILITY.md).
- [ ] **Azure field verification:** Azure is documented, **not field-verified**. The Bicep
  template has not been run against a real subscription; use
  [Azure — status and remaining checks](./AZURE.md#still-to-do) before relying on it.

## Related operator templates

- [Security and data flow](./WHITE_LABEL_SECURITY_DATA_FLOW.md)
- [Backup and disaster recovery](./WHITE_LABEL_BACKUP_DR.md)
- [Version compatibility](./WHITE_LABEL_COMPATIBILITY.md)
- [Support and SLO worksheet](./WHITE_LABEL_SUPPORT_SLO.md)
