# Spec: `prod` pointers for dependency repos

*Spec of record for how a repo that never deploys on its own (astrid-core, …) records
what is live. Task **AWTD-1015**, part of epic AWTD-1012 (a prod branch in every repo).*

Status: **decided** (Jon, 2026-09-26: *"Prod pointer moves when consumer app moves (e.g.
when we ship and version) and we should list the version number"*). Not built.

Reference implementation: [`scripts/advance-prod-branch.sh`](../../scripts/advance-prod-branch.sh)
and the `advance-prod-branch` job in `.github/workflows/production-deployment.yml`.

---

## The rule

**A dependency repo's pointer moves when an app that consumes it ships, and not otherwise.**
Nothing is live for astrid-core on its own. What is live is "the astrid-core commit that
Windows v1.4.2 was built from". So:

| Where | What | Moved by |
|---|---|---|
| dependency repo | branch **`<app>-prod`**, e.g. `windows-prod` in astrid-core | the app's release job |
| dependency repo | tag **`<app>-v<version>-<UTC stamp>-<sha7>`**, e.g. `windows-v1.4.2-20260926-201500-abc1234` | the same job, same run |

- **One branch per consuming app.** Two apps can ship different astrid-core commits, and a
  single `prod` could only describe one of them. `git branch -r --list 'origin/*-prod'` in
  the dependency answers "what does every live app run".
- **The version is in the tag**, as Jon asked. The tag is `advance-prod-branch.sh`'s
  existing `<prefix>-<stamp>-<sha7>` with the prefix set to `<app>-v<version>`. So
  the same script and the same idempotency cover both cases, and the tag name alone says
  which release pinned which commit.
- **It follows the app, rollbacks included.** If the app rolls back to a release that pinned
  an older commit, `<app>-prod` moves backwards. The script already allows that and emits a
  `::warning::`.
- **Rehearsals don't move it.** The same rule applies as for the app's own `prod`: a
  `workflow_dispatch` rehearsal or a TestFlight-only upload is not a release.

## Where the pinned commit comes from

The job reads it from what the build actually used, never from the dependency's `main`:

- **Cargo git dependency:** the `#<sha>` suffix of the dependency's `source =
  "git+https://github.com/Graceful-Tools/<repo>…#<sha>"` line in `Cargo.lock`.
- **SwiftPM:** `revision` in `Package.resolved`.
- **npm git dependency:** the `#<sha>` in `package-lock.json`'s `resolved`.
- **A path or workspace dependency inside the app's own repo** needs no pointer. It is
  already covered by the app's own `prod`.
- **A path dependency on a sibling checkout** (`../astrid-core`) pins nothing, so there is
  no commit to point at. A release build must use a git pin. The job fails loudly rather
  than guess.

## Credential (needs Jon)

The app's release job runs in the app's repo. `GITHUB_TOKEN` cannot push to another
repository, so moving a branch in astrid-core from astrid-windows' workflow needs a
credential with `contents: write` on the dependency. Either:

1. **A GitHub App** installed on the dependency repos, minted per run with
   `actions/create-github-app-token`. This is recommended: tokens are short-lived and scoped
   per repo.
2. **A fine-grained PAT** limited to the dependency repos' contents, stored as a secret in
   each consuming repo.

Once each dependency's `*-prod` branches exist, the same ruleset as web's `prod` applies:
only that credential may push, and force-push is allowed for it.

## Rollout

1. **Inventory:** list every repo that ships no artefact of its own, and which apps consume
   it, how (git, path or registry), and where the pin lives. Known today: astrid-core →
   astrid-windows (Cargo). Unknown: whether astrid-ios consumes astrid-core.
2. Create the credential (Jon).
3. For each consuming app, add a step after its release job publishes: read the pin, check
   out the dependency at that commit, and run `advance-prod-branch.sh <sha> <app>-prod
   <app>-v<version>`.
4. Protect the `*-prod` branches once the first run has created them, as in AWTD-1014.
