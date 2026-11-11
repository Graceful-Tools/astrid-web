# White-label release compatibility matrix

Use this matrix to record the exact web release image, client builds, and
`astrid-core` revisions tested together for one deployment. It is an evidence ledger, not
a promise that arbitrary client and server versions are interchangeable.

## Status: verified versus assumed

**Verified in this repository:** the web release workflow publishes a versioned app image
and matching migrator image; the server's WebAssembly package records its
`astrid-core` source revision in `packages/astrid-rules/REVISION`; iOS/Mac, Android, and
Windows clients are separate repositories and pin `astrid-core` independently.
Evidence: `.github/workflows/release-image.yml`, `packages/astrid-rules/REVISION`,
`ASTRID.md` → “Repository Structure” and “Cross-platform contracts”, and
`docs/WHITELABELING.md` → “Native apps, per platform”.

**Not established by this repository:** a centrally maintained supported-version window,
an automatic cross-client compatibility guarantee, or a tested compatibility result for
your particular deployment. Native client releases and their core pins must be verified
from their own build/release records.

## Deployment compatibility record

Copy one row per deployment release. Do not replace version or digest fields with
`latest`/`edge`; record the immutable artifact and tested commit.

| Deployment / date | Web app image tag + digest | Migrator image tag + digest | Web commit SHA | Server `astrid-core` revision (`packages/astrid-rules/REVISION`) | iOS/Mac build + core revision | Android build + core revision | Windows build + core revision | Migration result | Smoke/compatibility evidence |
|---|---|---|---|---|---|---|---|---|---|
| `[deployment / date]` | `[tag / digest]` | `[tag / digest]` | `[SHA]` | `[revision]` | `[build / revision or N/A]` | `[build / revision or N/A]` | `[build / revision or N/A]` | `[migration version / result]` | `[test run / date / result]` |

The app and migrator are separate release images; the migrator runs before the app rollout.
The release image workflow builds the app with the source commit as `GIT_COMMIT_SHA` and
publishes SBOM/provenance metadata (`.github/workflows/release-image.yml`,
`docs/deployment/SELF_HOSTING.md` → “Published images”).

## Verification checklist

- [ ] Record the web app and migrator tags and immutable digests from the same release.
- [ ] Record the web commit SHA and the server core revision from
  `packages/astrid-rules/REVISION`.
- [ ] For each shipped client, record its platform build number, commit/release identifier,
  and that repository's pinned `astrid-core` revision.
- [ ] Run the deployment's health/capabilities probes and API smoke tests against the
  recorded web image (`docs/deployment/SELF_HOSTING.md` → “Quick start”).
- [ ] Exercise sign-in, sync, task read/write, and uploads from every client build included
  in the deployment; record pass/fail and the exact build pair.
- [ ] Check the web API contract and release notes for changes before upgrading
  (`docs/API_CONTRACT.md`, `CHANGELOG.md`).
- [ ] Re-run the matrix after upgrading the server, a native client, or an `astrid-core`
  pin. A client core revision and the server's WebAssembly revision are separate values.

The compatibility status of an untested pair is **not verified**, not “supported by
default.” This repository's web contract fixtures are generated and checked in web first;
client and core release validation remains in their respective repositories
(`ASTRID.md` → “Cross-platform contracts”).
