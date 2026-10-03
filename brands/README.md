# Brand profiles

Each `*.brand.json` here is a deployment profile: the brand identity plus which service
dependencies that deployment offers. `tests/brands/brand-matrix.test.ts` runs the same
suite of assertions against **every** profile in this directory, so adding a partner
means adding one file — the tests pick it up automatically.

Run just these: `npm run check:brands`. They also run inside `npm run predeploy` as
their own gate, so a change that only works for Astrid cannot ship.

## Adding a partner

1. Copy `acme.brand.json`, change the values.
2. `npm run check:brands`.

That is the whole process. If the new profile fails, the failure is a real
whitelabelling gap — something in the app is still assuming Astrid's values or Astrid's
enabled services.

## Fields

| Key | Meaning |
|---|---|
| `name` | Profile name, used in test output only |
| `description` | What this profile is exercising |
| `env` | Environment variables applied when evaluating the profile |
| `expect.appName` / `expect.domain` | Brand values the app must derive |
| `expect.enabledAgents` | Agent mailboxes `getAllAgentConfigs()` must return |
| `expect.capabilities` | Capability keys that must be on / off |
| `expect.forbidLiterals` | Strings that must NOT appear in rendered output for this
  profile (e.g. a rebranded deployment must not leak "Astrid") |
| `copy` | Optional. Brand *voice*: reminder nags and default-list captions |

## Brand voice (`copy`)

Some content is not a value but a personality. Astrid's reminder nags ("I die a little
every time you ignore me") and its starter-list captions are written in a particular
tone that a partner will usually want to replace outright rather than translate.

```json
"copy": {
  "reminders": {
    "general":   ["A moment, please.", "Your attention is requested."],
    "due":       ["This item is now due."],
    "responses": ["Ready when you are."]
  },
  "defaultLists": {
    "today":       { "name": "Due Today", "description": "items scheduled for today" },
    "not-in-list": { "name": "Unfiled" },
    "assigned":    { "name": "Delegated" }
  }
}
```

Everything is optional and falls back per field, so a profile can rename a list without
restating its description, or replace the nags while leaving lists alone. The block is
serialised into `NEXT_PUBLIC_BRAND_COPY` by `lib/brand/profile.ts` — the same function
the tests use, so a profile is applied identically whether it is deployed or asserted.

Malformed JSON logs a warning and falls back to the built-in voice rather than throwing:
bad brand copy should never take down reminders. An empty override array counts as *not
supplied* — a brand that wants no nags should disable reminders rather than ship blank
notifications.

## One profile, three platforms

These files are **not web-only**. The iOS and Mac apps read the same profile:

```bash
cd ../astrid-ios
./scripts/apply-brand.sh acme        # write the profile into both Info.plist files
./scripts/check-brands.sh            # apply each profile, audit it, revert
```

`Astrid App/Utilities/BrandProfile.swift` maps the profile's variables onto the
Info.plist keys `Brand` reads, and `BrandProfileTests` **parses `Brand.swift`** and fails
if any key it reads has no mapping. So a brand value a partner cannot configure is a
build failure rather than something they discover after shipping — that guard is what
surfaced `NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR` and `NEXT_PUBLIC_BRAND_ACCENT_TEXT_COLOR`
as missing.

Those two are **consumed by the native apps only**, and that is fine: a shared profile
describes more than one platform, so a key only one of them reads is normal. The web
derives its hover and on-accent colours in CSS; SwiftUI has no cascade to derive them
from, so the native apps need them as values.

Variables the native apps consume: `NEXT_PUBLIC_BRAND_NAME`, `_DOMAIN`, `_WORDMARK`,
`_SLOGAN`, `_SUPPORT_EMAIL`, `_INBOUND_TASK_EMAIL`, `_AGENT_NAME`, `_ACCENT_COLOR`,
`_ACCENT_HOVER_COLOR`, `_ACCENT_TEXT_COLOR`, and `BRAND_AGENT_EMAIL_DOMAIN`. Everything
else in `env` is web-only and is skipped, not rejected.

The `copy` block reaches the native apps a different way — over the wire, from
`GET /api/v1/capabilities`, cached locally so reminders scheduled offline still speak in
the brand's voice. Nothing about it needs configuring per platform.

## The two profiles that must always exist

- **`astrid.brand.json`** — the production configuration. Proves the refactor did not
  change today's behaviour: no env set, everything on, every value the Astrid default.
- **`acme.brand.json`** — a fully rebranded deployment with several services disabled.
  Proves the whitelabelling actually works end to end rather than merely compiling.

## Deploying a profile as a preview

`NEXT_PUBLIC_*` values are inlined at build time, so a brand preview needs them passed as
build env rather than set on the Vercel project:

```bash
npx tsx scripts/deploy-brand-preview.ts acme
```

That reads `brands/acme.brand.json` and deploys with its `env` applied.

Add `--alias <hostname>` to give the preview a stable address on the `*.astrid.cc`
wildcard, the way `deploy-preview.sh` does for branches:

```bash
npx tsx scripts/deploy-brand-preview.ts whitelabel --alias whitelabel.astrid.cc
```

`whitelabel.brand.json` is exactly that: the standing white-label test site, styled after
GitHub (light by default, GitHub blue, system font). Its `description` explains why it
keeps `astrid.cc` as its domain — sign-in on a `*.astrid.cc` preview depends on it.

### One value is pinned, not taken from the profile

`BRAND_AGENT_EMAIL_DOMAIN` is forced to `astrid.cc` on previews. Preview deployments
share the production database, and `ensureAstridAgent()` / `ensureAgentUser()` create
agent `User` rows on demand — so a preview at a different agent domain would write
`astrid@agents.acme.example` and friends into production data the moment anyone opened
the agent picker.

**Pinned, not omitted.** `BRAND.agentEmailDomain` falls back to
`NEXT_PUBLIC_BRAND_DOMAIN`, so merely leaving the variable out still moves agent
identities — to the brand's *web* domain instead. That was the first attempt here, and
checking the deployed preview showed it resolving agents at `tasks.acme.example`. An
absent variable is not the same as a safe one.

The agent-domain change is covered by unit tests and by
`scripts/migrate-agent-email-domain.ts`. It should be exercised against a real partner
database, not against production via a preview.

### Links point at the project's NEXTAUTH_URL

A preview inherits the Vercel project's `NEXTAUTH_URL`, so absolute links in `/llms.txt`
and the plugin manifest reference the project's own host rather than the brand's. That is
environment configuration, not a whitelabel gap — a real partner deployment sets its own
`NEXTAUTH_URL` alongside the brand variables.

## A partner deployment of its own (the full test)

A preview shows a brand; it does not test one. It shares Astrid's database, pins agent
identities to `astrid.cc`, and signs in by bouncing through `astrid.cc`. The only way to
exercise the whole path — the session cookie on the partner's domain, passkeys under the
partner's RP ID, agent mailboxes at the partner's agent domain, the schema migrated into an
empty database — is a deployment of its own. `whitelabel-partner.brand.json` is that, at
`https://tasks.gracefultools.com`, in the Vercel project `whitelabel-partner`.

To stand one up:

1. **Project.** `vercel project add <name>`, then set its framework to Next.js (the CLI
   creates it as "Other").
2. **Domain.** Add it to the project; point DNS at the CNAME Vercel recommends.
3. **Database.** `npx tsx scripts/provision-brand-database.ts --project <name>` creates a
   Neon project of the same name in the Graceful Tools org (`NEON_API_KEY` in `.env.local`)
   and writes `DATABASE_URL` (pooled) and `DATABASE_URL_DIRECT` to Production and Preview,
   printing no connection string. It refuses `astrid-web`, and a re-run is a no-op. (By hand:
   Vercel → the project → Storage → Create → Neon.) The first production build migrates it
   from empty.
4. **Environment.** `npx tsx scripts/push-brand-env.ts <profile> --project <name>` writes the
   profile, derives `NEXTAUTH_URL` from the brand domain, and generates `NEXTAUTH_SECRET`,
   `ENCRYPTION_KEY`, `CRON_SECRET` and `INTERNAL_API_SECRET` — only when absent, because
   rotating the first two signs everyone out and strands stored credentials. Run it again
   after attaching the database to map Neon's `DATABASE_URL_UNPOOLED` to the
   `DATABASE_URL_DIRECT` the build migrates through.
5. **Deploy** a production build of that project.

Sign-in starts passkey-only: Google and Apple each need an OAuth client registered for the
partner's domain, so the profile turns them off rather than advertise buttons that fail. The
native apps read the same `auth` capabilities and hide those buttons too.

### Native apps against a partner deployment

- **iOS / Mac:** `./scripts/apply-brand.sh whitelabel-partner` in astrid-ios points the app
  at the partner host and adds `webcredentials:` (and `applinks:` on iOS) for its domain, so
  native passkeys work there. The partner's site serves `apple-app-site-association` for the
  same app IDs. The build must be signed by Astrid's team, so it comes from Xcode Cloud or
  from Xcode on a machine with that team. `--reset` reverts, byte for byte.
- **Windows:** signs in through the browser (`/signin/desktop`), so passkeys on the
  partner's site need nothing native. The app must be pointed at the partner host.
- **The URL scheme stays `astrid`** in this profile. A scheme is part of an app's identity,
  and the test binaries register only `astrid://`; a partner's own scheme needs a
  partner-built app (bundle ID, scheme, store listing — frozen for us, see
  docs/WHITELABELING.md §7).
