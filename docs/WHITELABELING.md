# Whitelabeling

Astrid can be deployed under a different brand, with a different set of back-end
services, entirely through build-time configuration. No source changes, no fork of the
UI, no per-partner branches.

This document is the reference for doing that. Task `97208a72`.

> **The short version.** Write a `brands/<partner>.brand.json` profile, set its `env` on
> the deployment, and run `npm run check:brands`. Everything below explains what you can
> put in that profile and why some things deliberately cannot be configured.

---

## Start here: building your own branded Astrid

This walks a third party from a fresh clone to their own branded instance, with their own
native apps. Each step links to the section with the detail.

**First, the one architectural fact.** The web app *is* the server. The iOS, Mac, Windows
and Android apps speak only the Astrid API (`/api/v1`). So any branded deployment, including
one whose data lives in **GitHub Projects** rather than Astrid's own database, means running
astrid-web. There is no native client that talks to GitHub, or any other backend, directly.

1. **Clone and install.**

   ```bash
   git clone https://github.com/Graceful-Tools/astrid-web && cd astrid-web
   npm install
   ```

2. **Write a profile.** `cp brands/acme.brand.json brands/<partner>.brand.json` and edit
   `env`, plus `copy` if you want your own voice. Start from
   `brands/github-projects.brand.json` instead for a GitHub-backed brand. Every identity
   variable you leave out falls back to **Astrid's** value, so set all of §2, not just
   the name. Add `expect.forbidLiterals: ["Astrid"]` so a leak fails the check.

3. **Check it.**

   ```bash
   npm run check:brands
   ```

   This runs the brand matrix (§5) against every profile, yours included.

4. **Set the minimum environment.** There are six required variables: the two database URLs,
   `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `CRON_SECRET` and `ENCRYPTION_KEY` (table in §8).
   `scripts/push-brand-env.ts` writes the profile and generates the secrets. Sign-in
   providers, email, push and storage are optional.

5. **Deploy** to your own Vercel team and database: §8, *A partner on their own Vercel
   account and their own database*. Preview first with
   `npx tsx scripts/deploy-brand-preview.ts <partner> --team <id> --scope <slug>`. Then
   check `GET /api/v1/capabilities` on the preview; it should report your brand and
   providers.

6. **Point the native apps at it.** Each platform builds a variant from its own repo
   (*Native apps, per platform* below). For **native sign-in** there are two rules, because
   the desktop hand-off (`lib/auth/desktop-handoff.ts`) returns the browser to
   `<scheme>://auth/callback`:
   - **The scheme must match on both sides.** Set `NEXT_PUBLIC_BRAND_APP_URL_SCHEME` on
     the server to exactly the scheme your apps register. If they differ, sign-in
     completes in the browser and then deep-links into a different app, or into none.
   - **Keep the default hand-off client ids** (`windows`, `ios`, `mac`, `android`).
     `DesktopClientId` is a closed set on the server, so a custom `handoffClientId` in a
     native build is refused.

### Native apps, per platform

| Platform | Status | How a partner builds one | Task |
|---|---|---|---|
| **Web** | Supported | This document | — |
| **iOS / Mac** | Supported | astrid-ios: `./scripts/make-brand-variant.sh <profile or path>` writes the **Whitelabel** build configuration; `apply-brand.sh` writes identity (§6) | [AITD-515](https://astrid.cc/t/AITD-515) |
| **Windows** | Partial | astrid-windows: `scripts/package.ps1 -Brand <profile>`; `ASTRID_SERVER_URL` overrides the server at runtime. A non-`astrid` scheme also needs the core pin bumped past AWTD2-95 | [AWTD2-96](https://astrid.cc/t/AWTD2-96) |
| **Android** | Partial | astrid-android: `brands/<name>/brand.properties`, then `./gradlew assembleRelease -PastridBrand=<name>` (see its `brands/README.md`). In-app accent colours are still fixed, and verified app links need an `assetlinks.json`, which astrid-web does not serve yet | [AATD-72](https://astrid.cc/t/AATD-72) |
| **Core** (Windows and Android) | Partial | `urlScheme` and `handoffClientId` in the config JSON a shell passes; blank means Astrid's defaults | [AWTD2-95](https://astrid.cc/t/AWTD2-95) |

The Apple apps read the same `brands/*.brand.json` you wrote in step 2. Windows can too.
Android uses its own `brand.properties`, because the web profile describes the server's
environment and has nowhere to put an `applicationId`.

---

## 1. How it works

Three layers, each with one canonical home:

| Layer | Module | What it controls |
|---|---|---|
| **Identity** | `lib/brand/config.ts` | Name, wordmark, slogan, domain, emails, colours, artwork |
| **Capabilities** | `lib/brand/capabilities.ts` | Which auth methods, sync providers and integrations exist |
| **Voice** | `lib/brand/copy.ts` | Reminder nags and default-list captions |

Everything defaults to Astrid's current values, so **a deployment that sets nothing
behaves exactly as it does today**. That is enforced: `brands/astrid.brand.json` sets no
environment at all and is asserted on every predeploy.

### Two kinds of variable, and why it matters

| Prefix | Read | Vercel flag |
|---|---|---|
| `NEXT_PUBLIC_*` | inlined into the bundle at build | `--build-env` |
| everything else | by server code at request time | `--env` **and** `--build-env` |

Passing a server-only variable (`BRAND_ENABLED_AGENTS`, `BRAND_ASSISTANT_SERVICE`, `BRAND_AGENT_EMAIL_DOMAIN`) as
`--build-env` alone **silently does nothing** — present while Next compiles, absent when
the route runs. `scripts/deploy-brand-preview.ts` routes each variable correctly; if you
deploy by hand, do the same.

---

## 2. Identity

All optional. Each falls back to the Astrid value.

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_BRAND_NAME` | `Astrid` | Product name in copy |
| `NEXT_PUBLIC_BRAND_WORDMARK` | lowercased name | Header lockup — Astrid draws it lowercase |
| `NEXT_PUBLIC_BRAND_SLOGAN` | `Get it done!` | Beside the wordmark |
| `NEXT_PUBLIC_BRAND_TITLE` | `Astrid Task Manager` | `<title>`, OpenGraph, PWA manifest |
| `NEXT_PUBLIC_BRAND_TAGLINE` | *(prose)* | Metadata description |
| `NEXT_PUBLIC_BRAND_DOMAIN` | `astrid.cc` | Apex, no scheme |
| `NEXT_PUBLIC_BRAND_SUPPORT_EMAIL` | `support@astrid.cc` | |
| `NEXT_PUBLIC_BRAND_INBOUND_TASK_EMAIL` | `remindme@astrid.cc` | Email-to-task address |
| `NEXT_PUBLIC_BRAND_ACCENT_COLOR` | `#3b82f6` | `theme_color`, viewport, default list colour, and the UI accent (`--theme-accent`: buttons, links, focus ring) |
| `NEXT_PUBLIC_BRAND_DEFAULT_THEME` | `ocean` | `light`, `dark` or `ocean` — where a visitor starts; a stored choice still wins |
| `NEXT_PUBLIC_BRAND_WWW_REDIRECT` | `true` | `false` when the brand domain is a subdomain (`tasks.example.com`): no `www.` host exists to redirect to |
| `NEXT_PUBLIC_BRAND_FONT_FAMILY` | *(Inter)* | CSS `font-family` stack for the whole app, e.g. the system stack |
| `NEXT_PUBLIC_BRAND_AGENT_NAME` | brand name | Default assistant's display name |
| `NEXT_PUBLIC_BRAND_LOGO` | `/images/astrid-character.png` | Mascot art — sign-in, empty states |
| `NEXT_PUBLIC_BRAND_ICON` | `/icons/icon-512x512.png` | Large square mark |
| `NEXT_PUBLIC_BRAND_ICON_SMALL` | `/icons/icon-96x96.png` | Header mark |
| `NEXT_PUBLIC_BRAND_APP_STORE_URL` | Astrid's listing | **Empty string hides the button** |
| `NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG` | `astrid-code-assistant` | Your own registered GitHub App |
| `NEXT_PUBLIC_BRAND_WEBAUTHN_RP_ID` | *(derived)* | Only if inference is wrong — see §7 |
| `BRAND_APPLE_APP_IDS` | Astrid's apps | Server-only. Comma-separated `<TEAM ID>.<bundle id>` values for `/.well-known/apple-app-site-association`: each is listed for passkeys and for universal links (`/s/*`, `/tasks/*`, `/lists/*`). Set it when you ship your own iOS/Mac apps. Leave it unset if you run the Astrid-signed test binaries (`whitelabel-partner`) |

`public/` is served unchanged on every domain, so nothing brand-specific lives there.
`check:reuse` (`public-brand-literal`) fails if a brand literal or Apple app id appears in
it. The one exception is `public/sw.js`: its `astrid-*` cache names and `AstridOfflineDB`
are storage keys that users never see, and renaming them would orphan every installed
client's offline cache.

### Artwork

The square icons use **generic paths on purpose**: replace the files in `public/icons/`
and nothing needs configuring. The mascot is the exception — it ships under a
brand-specific filename, so it is a configurable path.

Copy in `lib/i18n/locales/*.json` refers to the product as `{appName}`, substituted at
load time by `lib/brand/i18n-values.ts`. Add a token there rather than a literal.

---

## 3. Capabilities

Every capability defaults to **enabled**. Set to `false` / `0` / `off` / `no` to disable.
An unrecognised value counts as enabled — a typo must not silently remove a feature.

| Variable | Turns off |
|---|---|
| `NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE` | Google sign-in (web and mobile) |
| `NEXT_PUBLIC_BRAND_ENABLE_AUTH_APPLE` | Sign in with Apple |
| `NEXT_PUBLIC_BRAND_ENABLE_AUTH_PASSKEY` | WebAuthn passkeys |
| `NEXT_PUBLIC_BRAND_ENABLE_SYNC_GOOGLE_TASKS` | Google Tasks sync |
| `NEXT_PUBLIC_BRAND_ENABLE_SYNC_GITHUB_ISSUES` | GitHub Issues sync |
| `NEXT_PUBLIC_BRAND_ENABLE_MCP` | MCP server and discovery |
| `NEXT_PUBLIC_BRAND_ENABLE_OPENCLAW` | Third-party OpenClaw workers |
| `NEXT_PUBLIC_BRAND_ENABLE_CHATGPT_ACTIONS` | OpenAPI + ai-plugin documents |
| `NEXT_PUBLIC_BRAND_ENABLE_CODING_AGENT` | The GitHub App coding agent (task → branch → PR → merge). Independent of Issues sync since AWTD-1094 — it used to ride on `SYNC_GITHUB_ISSUES`, so a profile that disabled Issues sync and wants the agent gone must now say so |
| `NEXT_PUBLIC_BRAND_ENABLE_PROJECT_MODE` | Projects, status boards and the team-shaped features |
| `NEXT_PUBLIC_BRAND_ENABLE_TASK_COST` | Per-task cost tracking |
| `NEXT_PUBLIC_BRAND_ENABLE_EMAIL_TO_TASK` | Inbound email-to-task |
| `NEXT_PUBLIC_BRAND_ENABLE_CALENDAR_FEED` | Public `.ics` feed |

**Opt-in capabilities.** The exceptions to "defaults to enabled": these are **off** unless
set to `true` / `1` / `on` / `yes`, and an unrecognised value leaves them off.

| Variable | Turns on | Requires |
|---|---|---|
| `NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS` | GitHub Projects as a task backend: an organisation's projects bound as boards and mirrored from GitHub (docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8) | `NEXT_PUBLIC_BRAND_ENABLE_PROJECT_MODE` on — a bound project *is* a board. The server refuses to start otherwise (`assertCoherentCapabilities` in `lib/brand/capabilities.ts`, called from `instrumentation.ts`). Also `github` in `NEXT_PUBLIC_BRAND_AUTH_PROVIDERS` and the brand's own GitHub App (§8) |
| `NEXT_PUBLIC_BRAND_ENABLE_GITHUB_AGENT_LABELS` | On a GitHub Projects board, an AI agent's assignment is shown on GitHub as a label `agent:<name>` on the issue. The label is created in the repo if it is missing. Labels under `agent:` then belong to the mirror: one for an agent not assigned in the app is removed, and none becomes a label list | `NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS` on, and your GitHub App needs Issues: write |
| `github` and `sso` in `NEXT_PUBLIC_BRAND_AUTH_PROVIDERS` | Sign in with GitHub, enterprise SSO | Their credentials — see *Sign-in providers* below |

GitHub Projects is **never on astrid.cc**: `brands/astrid.brand.json` does not set the
switch, and `tests/rules/astrid-never-enables-github-projects.test.ts` fails the build if it
ever does. A GitHub-backed brand normally also turns `SYNC_GITHUB_ISSUES`,
`SYNC_GOOGLE_TASKS` and `TASK_COST` off, since GitHub is its backend —
`brands/github-projects.brand.json` is the reference profile.

Two of these — `PROJECT_MODE` and `TASK_COST` — existed in
`lib/brand/capabilities.ts` for some time without appearing here or in
`.env.example`, so a partner had no way to learn they were switchable
(task 229c175c).

**CORS.** `/api` accepts credentialed cross-origin requests from this brand's own
apex and `www` hosts only. Add others with `CORS_ALLOWED_ORIGINS` (comma-separated,
scheme included). An origin that is not on the list receives no
`Access-Control-Allow-Origin` header at all, and every API response carries
`Vary: Origin`. This is enforced in `middleware.ts` via `lib/cors.ts`, NOT in
`next.config.mjs`: a static header cannot vary by request, which is how the old
configuration ended up granting `https://astrid.cc` credentialed access to every
deployment.

### Sign-in providers

Which sign-in methods a brand offers is one ordered list:

```bash
NEXT_PUBLIC_BRAND_AUTH_PROVIDERS="github,google,apple,passkey,sso"   # also the button order
```

| Provider | Needs | Email trusted when |
|---|---|---|
| `github` | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — the brand's **GitHub App's own** OAuth client (`Iv…`), with "Email addresses: read" and `/api/auth/callback/github` among its callback URLs | GitHub reports it as the user's verified primary |
| `google` | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google's `email_verified` claim |
| `apple` | Nothing for iOS/Mac (the native token routes). The **web** button additionally needs `APPLE_SERVICES_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (a Sign in with Apple .p8 key), with `/api/auth/callback/apple` as the Services ID's Return URL; without all four the web button is simply absent, and a partial set is logged | Apple's `email_verified` claim |
| `passkey` | — (RP ID per §7) | verified by email, as before |
| `sso` | `AUTH_SSO_ISSUER`, `AUTH_SSO_CLIENT_ID`, `AUTH_SSO_CLIENT_SECRET`, `AUTH_SSO_DOMAINS` (optional `AUTH_SSO_LABEL`) — any OIDC IdP | it is in `AUTH_SSO_DOMAINS` — an IdP can assert any address, so trust is bound to domains |

- **Unset, the list is derived from the three `ENABLE_AUTH_*` switches**, so a deployment
  that sets nothing is unchanged. A switch set to off still removes its provider from an
  explicit list.
- **GitHub and SSO are never on by default.** Listing them is the only way in, and the
  server refuses to start if they are listed without their settings (`instrumentation.ts`
  → `lib/auth/provider-credentials.ts`). For the legacy providers a missing credential is
  logged rather than fatal.
- **Every federated sign-in links by one rule**, `lib/auth/federated-identity-linking.ts`:
  an identity already linked signs in; otherwise the email must be one the provider vouches
  for (above), and never an AI agent, an address at the agent domain, or
  `INITIAL_ADMIN_EMAIL`. A sign-in that fails the rule is refused, new user or not.
- **Clients** read `auth.providers` (ordered `{ id, kind }`) from
  `GET /api/v1/capabilities`, alongside the original booleans plus `github` and `sso`.

`sso` is one IdP per deployment. Per-organisation SSO is a partner's build, specified in
*Per-organisation SSO* below.

**At least one auth method must remain.** A build with none of them is an outage, not a
degraded feature, so `instrumentation.ts` asserts it at server start and the process
refuses to boot. Without that check the sign-in page renders a 200 with no buttons —
indistinguishable from a working page until a user tries to sign in.

### Per-organisation SSO: what a partner builds

The platform ships deployment-level SSO only: the `sso` provider above, one OIDC issuer from
env. That covers a white label serving one customer. A partner who runs one deployment for
**many** customer organisations, each with its own IdP, builds per-organisation SSO
themselves. Astrid does not ship it, and does not choose a broker (spec §15 C1,
[AWTD-1120](https://astrid.cc/t/AWTD-1120)). This is the contract that build must keep, so
that it extends the linking rule above rather than working around it.

**SAML reaches Astrid as OIDC.** The app speaks one protocol. A customer on SAML goes behind
a broker the partner runs: BoxyHQ SAML Jackson (open source, self-hosted), WorkOS (hosted), or
the IdP's own OIDC endpoint. Signature, audience, replay and clock-skew checks are the
broker's vetted code. **Never parse SAML in the app.** For a single customer on SAML no code
is needed at all: point `AUTH_SSO_ISSUER` at the broker's tenant.

For many organisations:

1. **One connection per organisation.** An additive table, in the spirit of spec §6.4 v2:

   | Field | Meaning |
   |---|---|
   | `workspaceId?` | The organisation it serves. Null means deployment-wide. |
   | `issuer`, `clientId`, `clientSecret` | The broker's or IdP's OIDC client: the per-connection form of `AUTH_SSO_*`. The secret is encrypted at rest. |
   | `domains[]` | Each with a `verifiedAt`. **Only verified domains count**, everywhere below. |
   | `required` | Whether this connection is the only way in for its domains (step 5). |
   | `label` | The button text, as `AUTH_SSO_LABEL` is today. |

2. **A domain counts only once DNS proves it.** Issue a random token, have the customer
   publish it as a TXT record on a brand-named label under their domain, and set
   `verifiedAt` only once a lookup finds it. Re-check on a schedule, and stop counting a
   domain whose record has gone. **A domain belongs to at most one connection** (a unique
   index). Without that, a second organisation that claims your domain can vouch for your
   users, and that is account takeover.

3. **"Continue with SSO" asks for a work email**, finds the connection that holds its
   verified domain, and starts that connection's OIDC flow with the same `pkce` and `state`
   checks the `sso` provider uses (`lib/auth-config.ts`). Answer an unknown domain the same
   way as a known one, so the page cannot be used to list a deployment's customers.

4. **Link through the one rule, never beside it.** Call `linkFederatedIdentity` or
   `signInWithVerifiedIdentity` (`lib/auth/federated-identity-linking.ts`) with
   `emailTrust: 'domain-bound'` and `allowedDomains` set to **this connection's** verified
   domains, never the union of every connection's. The refusals for AI agents, the agent
   domain and `INITIAL_ADMIN_EMAIL` then apply unchanged. Two details are easy to miss:
   - **The provider id must name the connection**, for example `sso:<connectionId>`.
     `Account` is unique on `(provider, providerAccountId)`, and an OIDC `sub` is unique only
     within one issuer, so two IdPs can issue the same `sub`. Deployment-level `sso` stores a
     bare `sub` and gets away with it only because it has a single issuer.
   - `FEDERATED_PROVIDERS` and `emailTrustFor` in `lib/auth-config.ts` match exact provider
     ids. A per-connection id must be routed to the domain-bound branch there, or it falls
     through to `emailTrust: 'none'` and every sign-in is refused.

5. **`required` closes every other door for that domain.** An address at a required
   connection's verified domain cannot sign in, or link, through Google, GitHub, Apple,
   passkey or email. That covers the web `signIn` callback, the native token routes
   (`lib/auth/native-sign-in.ts`) and passkey registration. Enforce it once, in the shared
   rule, not per provider. **Exempt `INITIAL_ADMIN_EMAIL`:** the rule already refuses to
   link it through SSO, so without the exemption a broken IdP locks the deployment's admin
   out.

6. **Deprovisioning ends sessions.** Sessions are JWTs (spec §6.5), so removing a user at
   the IdP does not sign them out. Add a per-user `sessionEpoch` integer and put it in
   every token minted: by NextAuth, by the native routes and by the desktop exchange
   (`app/api/v1/auth/desktop/exchange`). Reject any token whose epoch is behind the user's
   in the `jwt` callback. Bump the epoch when the IdP or broker reports the user
   deactivated (SCIM, or the broker's webhook), when their connection is deleted, and when
   `required` is turned on for their domain.

7. **The native apps need nothing new.** SSO already signs in through the desktop hand-off
   (`/auth/desktop?provider=sso`, AWTD-1105). A per-organisation flow carries the connection
   through that same hand-off, and no SAML or IdP SDK ships in the apps.

**Prove it red, then green** (spec §14, P7's exit criteria):
- An address outside the connection's verified domains is refused.
- A domain verified on connection A cannot be vouched for by connection B.
- A Google sign-in for a `required` domain is refused, and `INITIAL_ADMIN_EMAIL` still gets
  in.
- Two connections issuing the same `sub` create two users, not one.
- A token from before an epoch bump is rejected.

Run all of these against a stub OIDC issuer. Replay and audience checks belong to the
broker, so run the broker's own suite instead of re-implementing it. These are auth
changes, so run the full suite, not only the predeploy gate.

### Enforcement is server-side

A disabled capability **refuses the request**; it is not merely hidden in the UI. Hiding
a button while leaving the endpoint reachable is not a configuration option, it is an
unenforced access-control boundary.

- Routes using `withAuth` take a `capability` option, checked **before** authentication.
- Others call `capabilityGate(key)` and return its response.
- Both answer **404, not 403** — a capability this deployment does not have should look
  absent rather than withheld.

Discovery follows: `/llms.txt`, `/docs/integrate` and `WELL_KNOWN_ENDPOINTS` omit
disabled integrations instead of advertising endpoints that 404.

### Relationship to feature flags

`lib/feature-flags.ts` is a *runtime*, per-user, database-backed rollout mechanism.
Capabilities sit **above** it: a capability disabled at build time is off for everyone
and no runtime flag can turn it back on. Check the capability first.

### Agents

`BRAND_ENABLED_AGENTS=claude,openai` narrows which AI providers exist (server-only, so
it needs `--env`). The default assistant is always retained — dropping it would orphan
every task already assigned to it. Agent identities live at `BRAND_AGENT_EMAIL_DOMAIN`,
defaulting to the brand domain.

`BRAND_ASSISTANT_SERVICE=openai` picks the provider behind that default assistant — your
equivalent of Astrid — for any user who has not chosen one (AWTD-1056). One of `claude`,
`openai`, `gemini`, `copilot`; it must also be enabled, else the first enabled provider is
used, else Claude. A user's own choice in settings still wins. Local harnesses (`codex`,
`muse`) and Custom Agents cannot back it: the server dispatches nothing to them.
Server-only, like `BRAND_ENABLED_AGENTS`.

Clients learn all of this from **`GET /api/v1/capabilities`** rather than assuming, since
one mobile build can point at several deployments.

---

## 4. Voice

Reminder nags and default-list captions are a personality, not a translation. Supply them
as a `copy` block in the brand profile — see [`brands/README.md`](../brands/README.md).

The block is serialised into **`NEXT_PUBLIC_BRAND_COPY`** by `lib/brand/profile.ts`. Set
that variable directly only if you are not using a profile; malformed JSON logs a warning
and falls back to the built-in voice rather than throwing, because bad brand copy must
never take down reminders.

---

## 5. Testing a brand

```bash
npm run check:brands                              # every profile in brands/
npx tsx scripts/deploy-brand-preview.ts acme      # deploy one to Vercel
```

`tests/brands/brand-matrix.test.ts` runs the same assertions against **every**
`brands/*.brand.json`, so adding a partner is one file. It runs as its own predeploy gate
so a whitelabel regression is reported as itself rather than as one failure among 3000.

The profile's `expect.forbidLiterals` is the sharp end: a rebranded deployment leaking
"Astrid" into rendered output is invisible to the type checker, and this is what catches
it.

Tests and deploys apply a profile through the same `profileEnv()` in
`lib/brand/profile.ts`. Keep it that way — a harness that applies a profile differently
from a deploy will go green while shipping something else.

---

## 6. The iOS and Mac apps

The native apps read **the same `brands/*.brand.json` profile**. A partner describes
their brand once.

```bash
cd ../astrid-ios
./scripts/apply-brand.sh acme     # write the profile into both Info.plist files
./scripts/check-brands.sh         # apply each profile, audit it, revert
./scripts/check-brand.sh          # the brand-literal lint (mirrors check:reuse)
```

### Your own app: the Whitelabel build configuration

`apply-brand.sh` rebrands the app's *contents* under Astrid's own bundle ID and team. A
partner shipping **their own** app also needs their own bundle ID, App Group, keychain
group and Apple team. The **Whitelabel** build configuration carries these, and
`make-brand-variant.sh` writes them (AITD-515):

```bash
cd ../astrid-ios
./scripts/make-brand-variant.sh acme                    # a profile name, from ../astrid-web/brands
./scripts/make-brand-variant.sh ~/acme/acme.brand.json  # or a path: no astrid-web checkout needed
./scripts/make-brand-variant.sh acme --team ABCDE12345 --bundle-id com.acme.tasks
```

Each value comes from three places, and later ones win:
1. the defaults, which are Astrid's own Whitelabel variant;
2. an optional `ios` block in the profile;
3. the arguments `--bundle-id`, `--app-group`, `--keychain-group`, `--team` and
   `--display-name`.

The `ios` block sits beside `env` and is ignored by the web. The script rewrites only the
Whitelabel configurations in `project.pbxproj` and records what it wrote in a
`variant.json` beside them, so it can be re-run. With no `ios` block it reproduces the
committed files byte for byte. The full reference is astrid-ios's
[BRAND_VARIANT.md](https://github.com/Graceful-Tools/astrid-ios/blob/main/docs/BRAND_VARIANT.md).

`Astrid App/Utilities/Brand.swift` is the native `lib/brand/config.ts`, and
`BrandProfile.swift` maps profile variables onto the Info.plist keys it reads. See
[`brands/README.md`](../brands/README.md) for which variables the native apps consume.

### Three things arrive by three different routes, on purpose

| What | How | Why not the others |
|---|---|---|
| **Identity** (name, host, emails, artwork) | Info.plist, from the profile | Needed before any network call — the sign-in screen renders first |
| **Brand text** (appName, wordmark, slogan, agentName) | `GET /api/v1/capabilities` | One binary can point at several deployments; the build cannot know which brand it will serve |
| **Voice** (reminder nags) | same endpoint, then **cached locally** | The in-app reminder view renders before a fetch necessarily lands, and offline; reading live would show a partner's users Astrid's nags |

The server's values win where both exist, with the build's own as the fallback — so the
lockup is right before the first fetch, right if the fetch fails, and right against an
older server with no such endpoint.

**Scope of the voice.** The nags reach the **in-app reminder view only**. Scheduled
`UNNotification` bodies are the task's own title under a fixed "Task Due Soon" heading and
do not read brand copy at all. Branding and localising that heading is separate work, not
covered here.

### What the server is deliberately not allowed to set

- **`domain` / `agentEmailDomain`** — client-side trust boundaries. A server naming "its"
  brand domain would be telling a client which cookies to clear and which Universal Links
  to claim.
- **`accentColor`** — clients resolve colours once at launch (`static let`) so no render
  ever parses a hex string. A server-driven accent would mean an observable theme and a
  cost on every colour read.

Both are pinned by tests asserting the exact served key set, so adding one is deliberate.

### Why the native tests are structured the way they are

On an Astrid build, `XCTAssertEqual(Theme.accent, Brand.accentColor)` **passes even if
someone puts the literal back** — the two are equal because Astrid *is* the configured
brand. Verified by mutation. So the native suite has three layers, and only the last two
can see a whitelabel regression:

1. **Default-build tests** — prove the fallbacks. Necessarily vacuous about wiring.
2. **The iOS repository's `check-brand.sh`** — a source lint under its own `scripts/`, the only thing that catches a
   re-introduced literal while Astrid is the brand.
3. **`BrandAuditTests`** — skip on an Astrid build, run under an applied partner profile.
   These prove Info.plist configuration actually *reaches* `Brand`, and that no Astrid
   value survives a rebrand.

`BrandProfileTests` parses `Brand.swift` and fails if a key it reads has no profile
mapping — a brand value a partner cannot configure is a build failure, not a discovery
they make after shipping.

---

## 7. What cannot be configured, and why

Not oversights. Changing any of these breaks something real.

| Thing | Why it is frozen |
|---|---|
| `X-Astrid-Signature` / `-Timestamp` / `-Event` | Published webhook contract. Subscribers verify by exact header name; renaming delivers signatures under a header nobody reads, and they are treated as unsigned. See `lib/webhooks/protocol-headers.ts`. |
| `name_for_model: "astridTasks"` | Renaming breaks already-installed GPT actions. |
| `/.well-known/astrid-openapi.yaml` | Published endpoint path; existing integrations point at it. |
| `astrid-signed` | OpenClaw auth-mode value users type into their gateway config. |
| `completedSource: 'astrid'`, `astridListId`, `isAstridUser` | Stored values, schema columns and API fields. |
| Apple bundle identifiers | Provisioning identities tied to signing certificates. |
| `ASTRID.md` | Agent context filename, deliberately named. |
| iOS bundle IDs, keychain service, App Group, `astrid://`, associated domains | App Store Connect and provisioning. |

### Service providers: what is swappable, and what is fixed (task 1e772f0c)

This section used to be silent about the vendors the product runs on, so they
read as oversights. Some were. Here is where each one actually stands.

**Object storage — swappable.** Every read and write goes through
`lib/secure-storage.ts`, which is the only module allowed to name the vendor
(`putObject`, `deleteObject`, `issueClientUploadToken`). Eight other files used
to import `@vercel/blob` directly; `tests/rules/blob-storage-goes-through-secure-storage.test.ts`
now fails if a ninth appears, subpath imports included.

**Email — one transport, swappable.** `lib/email-transport.ts` holds the single
Resend client and the one rule deciding whether a message actually sends.
`lib/email.ts` and `lib/email-reminder-service.ts` supply content only. There
were two clients and two copies of that rule.

**Redis — already swappable, and better than it looked.** `lib/redis.ts` picks
Upstash's REST client only when `UPSTASH_REDIS_REST_URL` is set *and* the
environment is production; a deployment with `REDIS_URL` and no Upstash
variables uses a standard Redis client. A partner on self-hosted Redis
configures it, they do not fork it.

| Thing | Why it is frozen |
|---|---|
| Upstash REST for SSE cross-instance events (`lib/sse-utils.ts`) | The only one of the Redis call sites that is Upstash-only, and deliberately: SSE fan-out runs in serverless functions that hold no connection pool, so it needs a client that works over plain HTTP per invocation. A standard Redis socket client there would open a connection per request. Unlike `lib/redis.ts`, this path has no local fallback because it does nothing in development — events are kept in memory. |
| `web-push` (`lib/push-notification-service.ts`) | Not a vendor. Web Push is the **browser standard** (RFC 8030 / VAPID), and `web-push` is the library that speaks it. The push service is chosen by the user's browser, not by us, so there is nothing here for a partner to swap — only their own `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` to set. |

### The MCP server name is NOT frozen (task 979e1325)

This table used to be silent about it, which read as an oversight and was one.
The MCP server announces itself as `<wordmark>-task-manager-oauth`, derived from
`BRAND.wordmark` by `mcpServerName()` in `lib/brand/config.ts`.

The reason it differs from `name_for_model` directly above: OpenAI pins
`name_for_model` into every already-installed GPT action, so renaming it breaks
live installs. Nothing external pins the MCP server name — it is a display
string in the client's server list, and it is the most visible identity the
product has outside the app itself. A partner's users were installing a server
that introduced itself as Astrid.

The default API base URL for the standalone MCP servers follows the brand too
(`mcpDefaultBaseUrl()`), so a partner's server talks to their own API rather
than requiring every operator to remember `ASTRID_API_BASE_URL`.

### WebAuthn RP ID

The RP ID is resolved **per request from the `Origin` header**, not from configuration.
It is a *credential binding*: change it on a live deployment and every registered passkey
stops working.

- A request on the brand domain or a subdomain collapses to the brand domain — so a
  passkey registered on the apex is offered on `preview.<brand>`.
- Anything else scopes to the request host, so a deployment not yet served from its brand
  domain still works. Configuring `BRAND.domain` alone would claim an RP ID the browser
  is not on, and every passkey call fails with *"invalid for this domain"*.
- Override with `NEXT_PUBLIC_BRAND_WEBAUTHN_RP_ID` when inference is not enough.

The leading dot in every subdomain check is load-bearing: `endsWith(domain)` alone also
accepts `evil-<brand>.cc`. Pinned by `tests/lib/brand-security-boundaries.test.ts`.

---

## 8. Adding a partner

1. `cp brands/acme.brand.json brands/partner.brand.json` and edit it.
2. Drop their artwork into `public/` and point `NEXT_PUBLIC_BRAND_LOGO` at it.
3. `npm run check:brands`.
4. `npx tsx scripts/deploy-brand-preview.ts partner`.
5. Set the profile's `env` on their production deployment, **including their own
   `NEXTAUTH_URL`** — absolute links in `/llms.txt` and the plugin manifest derive from it.

Moving an existing deployment to a new agent-email domain also needs
`scripts/migrate-agent-email-domain.ts` (dry-runs by default). A fresh deployment does
not: agent rows are created lazily at whatever domain is configured.

### A partner on their own Vercel account and their own database

The steps above default to Astrid's Vercel team. Astrid's previews share Astrid's
production database. A partner running their own instance points the same tools at their
own team (AWTD-1280):

1. **Name the team.** Pass `--team <team id>` and `--scope <team slug>`, or set
   `VERCEL_TEAM_ID` and `VERCEL_SCOPE`. Flags win over the environment. With neither set,
   the scripts target Astrid's team.

   ```bash
   npx tsx scripts/push-brand-env.ts partner --project partner --team team_xxx --scope partner-co --dry-run
   npx tsx scripts/deploy-brand-preview.ts partner --team team_xxx --scope partner-co
   ```

   `deploy-brand-preview.ts` pins `BRAND_AGENT_EMAIL_DOMAIN=astrid.cc` **only on Astrid's
   team**, where a preview writes agent rows into Astrid's production data. On the
   partner's team it is their database, so the profile's agent domain is used as written.
2. **Attach a database** (Vercel → Storage → Neon, connected to Production and Preview),
   then run `push-brand-env.ts` again to map `DATABASE_URL_UNPOOLED` to
   `DATABASE_URL_DIRECT`.
3. **Set the minimum environment.** These are the `required` entries in `lib/env.ts`.
   `push-brand-env.ts` writes all of them except the database URLs, and it generates a
   secret only when that secret is absent:

   | Variable | What it is |
   |---|---|
   | `DATABASE_URL` | pooled Postgres, for runtime queries |
   | `DATABASE_URL_DIRECT` | unpooled Postgres; migrations run through it at deploy |
   | `NEXTAUTH_SECRET` | signs sessions; rotating it signs everyone out |
   | `NEXTAUTH_URL` | `https://<brand domain>`; callbacks and absolute links derive from it |
   | `CRON_SECRET` | cron routes fail closed without it |
   | `ENCRYPTION_KEY` | encrypts stored credentials; losing it makes them unrecoverable |

   Everything else is optional: sign-in providers, email, push, storage. `npm run
   check:env` lists the full registry.
4. **If they deploy with `production-deployment.yml`:** set the repository secrets
   `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `DATABASE_URL` and
   `DATABASE_URL_DIRECT`. Set the **repository variable** `PRODUCTION_URL` to their
   origin. Unset, the before-deploy probe, the commit-SHA verification and the health
   check all ask `https://astrid.cc`, which is Astrid's state, not theirs.
5. **Delete Astrid's own workflows.** These drive Astrid's agent loops and publish
   Astrid's SDK, and they do nothing useful in a fork:
   `.github/workflows/fixall.yml`, `fixstuff.yml`, `astrid-coding-agent.yml` and
   `publish-astrid-sdk.yml`.

### A GitHub Projects partner

Everything above, plus the parts that only a GitHub-backed brand has. Start from
`brands/github-projects.brand.json` ("Lanes for GitHub Projects") rather than `acme`.

1. **Name it.** "\<Brand\> for GitHub Projects" is the form GitHub's brand guidelines
   allow. A `NEXT_PUBLIC_BRAND_NAME` that starts with "GitHub" fails `check:brands`.
2. **Set the profile's switches:** `AUTH_PROVIDERS=github,sso` (or `github` alone),
   `ENABLE_GITHUB_PROJECTS=true`, `ENABLE_PROJECT_MODE=true`, and
   `ENABLE_SYNC_GITHUB_ISSUES`, `ENABLE_SYNC_GOOGLE_TASKS`, `ENABLE_TASK_COST` all `false`.
   `ENABLE_CODING_AGENT` is the partner's choice; off removes two App permissions below.
3. **Register the brand's own GitHub App** — never Astrid's. Under the partner's GitHub
   organisation:
   - Callback URLs: `https://<domain>/api/auth/callback/github` (sign-in) and
     `https://<domain>/api/github/setup` (installation).
   - Webhook URL: `https://<domain>/api/github/webhooks`, with a secret.
   - Permissions: Organization projects read/write · Issues read/write · Pull requests
     read · Metadata read · Members read · Email addresses read. With the coding agent
     on, also Pull requests write and Contents write.
   - Events: `installation`, `projects_v2`, `projects_v2_item`, `issues`,
     `issue_comment`, `sub_issues`, `label`, `milestone`, `pull_request`, `member`,
     `membership`, `organization`.
     `issue_comment` is required: it is how a comment made on github.com reaches the
     task, and how that comment's later edits and deletion reach it too (AWTD-1283).
     Without it, comments go one way only, from the app to GitHub.
     A commenter with no account on the deployment is shown by GitHub login.
     The App's own comments, which are agents' comments posted from the app, are never
     mirrored back.
   - "Request user authorization (OAuth) during installation" on, and user-to-server
     token expiry on: edits are made with the acting user's own token.
4. **Give the deployment the App's credentials:** `GITHUB_APP_ID`,
   `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (the App's own
   `Iv…` OAuth client), `GITHUB_WEBHOOK_SECRET`, and the App's slug in
   `NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG`. The server refuses to start with `github` listed
   and no OAuth client, and with GitHub Projects on and any of these six unset — naming
   each one missing (`assertGithubProjectsCredentials`, AWTD-1282).
5. `npm run check:brands`, then `npx tsx scripts/deploy-brand-preview.ts github-projects`.
   The preview must carry the App's credentials or it will not boot; add the preview's
   callback URLs to the App first.
6. **Verify on the preview:** `GET /api/v1/capabilities` reports
   `product.githubProjects: true` and `auth.providers` as listed; sign in with GitHub;
   install the App on a test organisation; bind one project and watch it import.
7. **Marketplace listing**, if the partner wants one: the copy and the form's answers for
   Lanes are in [deployment/LANES_GITHUB_MARKETPLACE.md](./deployment/LANES_GITHUB_MARKETPLACE.md).
   Pricing and plans are the partner's (spec §15 C4).
8. **Native apps:** astrid-ios's `apply-brand.sh` script (§6), then `BrandAuditTests`
   under the partner profile. The native apps never talk to GitHub themselves: they
   sign in to, and sync through, this deployment's Astrid API.

---

## 9. Keeping it working

`npm run check:reuse` fails the build on a hardcoded brand literal anywhere in
`components`, `app`, `hooks` or `lib`. It matches `Astrid`, `astrid.cc`, brand-named
asset paths, the lowercase wordmark as a JSX text node, and the slogan.

The main pattern is **case-sensitive on purpose** so identifiers (`AstridEmptyState`,
`astridPhrase`, `astrid-signed`) are not flagged. That is exactly why `<h1>astrid</h1>`
once survived every sweep and shipped an Astrid wordmark on a partner's sign-in page —
hence the separate JSX-text pattern. When adding a rule here, plant a violation and
confirm it fires: a rule that is green because its grep is malformed is worse than none.
