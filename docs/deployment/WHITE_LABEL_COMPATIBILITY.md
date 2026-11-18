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

## The stock apps on your server: the API level (ADEV-124)

A deployment doesn't have to ship branded apps. People can install the stock Astrid apps and
type your server's address on the sign-in screen ("Use a different server"). Then our app
updates on our schedule and your server on yours, and this is the rule that keeps that working:

- **Your server states its level.** `GET /api/v1/capabilities` returns `meta.apiLevel`, an
  integer that rises by one whenever the server gains behaviour a client may depend on
  (`lib/api-level.ts` keeps the history). A server older than the field sends none, which
  clients read as `0`.
- **An app refuses a server below the level it needs, by name.** It shows "this server needs an
  update" rather than signing in and failing later. It applies only to a server the person
  chose: an app built for a deployment ships with it.
- **What an app needs.** The stock apps need level **1** (browser sign-in on your server
  calls back to the stock app's scheme). An app raises its minimum only for a feature it can't
  work without. Optional features follow the capability flags instead, so a newer app keeps
  working, with less, against an older server.
- **Support window.** Keep your server within one minor release of `main`. The stock apps
  raise their minimum level only in a release whose notes say so, and at least 30 days after
  the server change that introduced that level reached `main`. The first requirement, level 1,
  ships with the feature itself: no server could serve the stock apps before it.

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
