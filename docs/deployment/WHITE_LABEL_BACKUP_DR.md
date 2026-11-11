# White-label backup and disaster-recovery runbook

This is a provider-neutral runbook template, not a tested recovery service or a committed
recovery objective. Use it with the platform-specific procedures in
[Self-hosting](./SELF_HOSTING.md#upgrades) and
[Azure](./AZURE.md#backups-and-restore).

## Status: verified versus assumed

**Verified in this repository:** uploads are stored separately from PostgreSQL; encrypted
credentials require `ENCRYPTION_KEY`; self-hosting calls for backups of the database,
uploads, and encryption key; Azure documents point-in-time database restore and separate
storage retention. The release includes a separate migrator image and migrations are
forward-only. Sources are linked below.

**Not verified:** backup schedules, provider retention, cross-region copies, encryption
and access controls for backup copies, alerting, actual restore duration, and recovery
success for your deployment. Verify these against your chosen provider and record evidence
from an isolated restore drill.

## Decide and record before launch

| Record | Operator value |
|---|---|
| Deployment and service owner | `[deployment / accountable owner]` |
| Database provider, backup method, and restore procedure | `[provider procedure and runbook link]` |
| Upload/object store and backup or versioning method | `[provider procedure and runbook link]` |
| Secret manager and key-recovery approvers | `[secret manager / roles]` |
| Last successful restore drill and evidence | `[date / environment / result]` |
| RPO — maximum acceptable data loss | TODO(Jon): decision |
| RTO — target time to restore service | TODO(Jon): decision |
| Recovery contact and escalation path | `[deployment operator contact]` |

No RPO or RTO is specified by this repository. Do not turn a provider's configured backup
window into a service-level recovery promise without testing the full restore path.

## Back up

| Item | Why it is needed | Evidence and operator action |
|---|---|---|
| PostgreSQL database | Stores users, sessions, task data, comments, configuration, and application events. | `prisma/schema.prisma`; configure provider backups or database snapshots and verify they can be restored. |
| Uploaded objects | Stored outside PostgreSQL; database rows alone do not restore object bytes. | `lib/storage/object-store.ts`; configure backup, replication, or versioning for the selected local volume, bucket, or blob container. |
| `ENCRYPTION_KEY` and any active rotation key | Required to decrypt encrypted fields after database restore. | `lib/env.ts`, `lib/field-encryption.ts`; keep an access-controlled recovery copy separate from the database backup. |
| Other runtime secrets and identity configuration | Required to authenticate users, call cron routes, connect providers, and serve the intended brand. | `lib/env.ts`; export from the secret manager using its recovery process, never into public logs or repository files. |
| Exact app and migrator image references, brand profile, and deployment configuration | Needed to reproduce the same runtime and choose a schema-compatible image. | `.github/workflows/release-image.yml`, `scripts/brand-env-file.ts`, and `docs/deployment/SELF_HOSTING.md` → “Published images”. Record immutable digests where the registry provides them. |
| Redis state | Realtime/cache state is not the authoritative application database; Azure documents Redis as not backed up. | `lib/realtime/bus.ts`, `docs/deployment/AZURE.md` → “Backups and restore”. Confirm whether any separately added workload stores durable data there. |

The three self-hosting backup essentials are the PostgreSQL data, uploaded objects, and
`ENCRYPTION_KEY` (`docs/deployment/SELF_HOSTING.md` → “Upgrades”). Keep secret backups
restricted and test access using the same break-glass process that would be used during an
incident.

## Restore drill

Perform this drill in an isolated recovery environment. Do not overwrite production data or
change public DNS during the exercise.

1. **Choose a recovery point and version.** Record the target time, database snapshot or
   point-in-time restore, corresponding object backup, and the app/migrator image digests.
   The selected recovery point must be within the operator's approved RPO.
2. **Provision an isolated environment.** Create a separate database, object-storage target,
   network, and secret scope. Use a separate public test hostname or keep the service
   private during validation.
3. **Restore database and objects.** Use the database and object-store provider's documented
   restore mechanisms. Confirm that the object store is reachable by the app and that the
   database backup corresponds to the intended recovery point.
   Stored attachment rows keep the URL they were written with, and for local and
   S3-compatible storage the app hands that URL back unchanged
   (`generateSignedDownloadUrl` in `lib/secure-storage.ts`). A drill on a different
   hostname can therefore read an old attachment from production and appear to pass.
   Check that a known pre-backup attachment is served by the restored store (block the
   production origin from the drill network, or compare the serving host).
4. **Restore the required keys.** Supply the matching `ENCRYPTION_KEY` and deployment
   secrets. Without the encryption key, encrypted values cannot be recovered
   (`lib/env.ts`, `lib/field-encryption.ts`).
5. **Choose a schema-compatible app version.** Apply only the migrator associated with the
   selected release if its documented upgrade procedure requires it. Do not assume a
   migration can be reversed: Prisma release migrations are forward-only, and a previous
   app image is safe only when its release notes permit it
   (`.github/workflows/release-image.yml`,
   `docs/deployment/SELF_HOSTING.md` → “Upgrades”).
6. **Validate recovery.** Check `/api/health`, sign in with a test identity, read expected
   records, verify an authorized upload and read-back, and run
   [`scripts/self-host-smoke.ts`](../../scripts/self-host-smoke.ts). Check configured
   mail/realtime paths only if they are part of the deployment.
7. **Measure and record.** Capture elapsed time, the restored data point, test results,
   missing data, manual steps, and owner sign-off. Update the runbook and reassess the
   operator's RPO/RTO; this drill does not set a public commitment.

## Recovery and rollback cautions

- Application rollback does not roll back database schema. Deploying a prior app image
  against a migrated database is safe only when the release notes say so; otherwise restore
  the backup together with a compatible image (`docs/deployment/SELF_HOSTING.md` →
  “Upgrades”, `docs/deployment/AZURE.md` → “Upgrades”).
- Restore the database and its corresponding objects and encryption key as one recovery
  set. A database-only restore can leave file references without their bytes, and encrypted
  credentials without the key cannot be read (`docs/deployment/SELF_HOSTING.md` →
  “How uploads work off Vercel” and “Upgrades”; `lib/field-encryption.ts`).
- Preserve the original environment until the restored instance passes validation and the
  authorized operator approves cutover. DNS and traffic cutover are provider-specific.

## Sources

- `lib/env.ts`, `lib/field-encryption.ts`, `lib/storage/object-store.ts`,
  `lib/realtime/bus.ts`
- `prisma/schema.prisma`
- `.github/workflows/release-image.yml`
- `docs/deployment/SELF_HOSTING.md` → “Published images” and “Upgrades”
- `docs/deployment/AZURE.md` → “Backups and restore” and “Upgrades”
