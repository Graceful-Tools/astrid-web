# Whitelabeling

Astrid can be deployed under a different brand, with a different set of back-end
services, entirely through build-time configuration. No source changes, no fork of the
UI, no per-partner branches.

This document is the reference for doing that. Task `97208a72`.

> **The short version.** Write a `brands/<partner>.brand.json` profile, set its `env` on
> the deployment, and run `npm run check:brands`. Everything below explains what you can
> put in that profile and why some things deliberately cannot be configured.

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

Passing a server-only variable (`BRAND_ENABLED_AGENTS`, `BRAND_AGENT_EMAIL_DOMAIN`) as
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
| `NEXT_PUBLIC_BRAND_ACCENT_COLOR` | `#3b82f6` | `theme_color`, viewport theme |
| `NEXT_PUBLIC_BRAND_AGENT_NAME` | brand name | Default assistant's display name |
| `NEXT_PUBLIC_BRAND_LOGO` | `/images/astrid-character.png` | Mascot art — sign-in, empty states |
| `NEXT_PUBLIC_BRAND_ICON` | `/icons/icon-512x512.png` | Large square mark |
| `NEXT_PUBLIC_BRAND_ICON_SMALL` | `/icons/icon-96x96.png` | Header mark |
| `NEXT_PUBLIC_BRAND_APP_STORE_URL` | Astrid's listing | **Empty string hides the button** |
| `NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG` | `astrid-code-assistant` | Your own registered GitHub App |
| `NEXT_PUBLIC_BRAND_WEBAUTHN_RP_ID` | *(derived)* | Only if inference is wrong — see §6 |

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
| `NEXT_PUBLIC_BRAND_ENABLE_EMAIL_TO_TASK` | Inbound email-to-task |
| `NEXT_PUBLIC_BRAND_ENABLE_CALENDAR_FEED` | Public `.ics` feed |

**At least one auth method must remain.** A build with all three off is an outage, not a
degraded feature, so `instrumentation.ts` asserts it at server start and the process
refuses to boot. Without that check the sign-in page renders a 200 with no buttons —
indistinguishable from a working page until a user tries to sign in.

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

## 6. What cannot be configured, and why

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

## 7. Adding a partner

1. `cp brands/acme.brand.json brands/partner.brand.json` and edit it.
2. Drop their artwork into `public/` and point `NEXT_PUBLIC_BRAND_LOGO` at it.
3. `npm run check:brands`.
4. `npx tsx scripts/deploy-brand-preview.ts partner`.
5. Set the profile's `env` on their production deployment, **including their own
   `NEXTAUTH_URL`** — absolute links in `/llms.txt` and the plugin manifest derive from it.

Moving an existing deployment to a new agent-email domain also needs
`scripts/migrate-agent-email-domain.ts` (dry-runs by default). A fresh deployment does
not: agent rows are created lazily at whatever domain is configured.

---

## 8. Keeping it working

`npm run check:reuse` fails the build on a hardcoded brand literal anywhere in
`components`, `app`, `hooks` or `lib`. It matches `Astrid`, `astrid.cc`, brand-named
asset paths, the lowercase wordmark as a JSX text node, and the slogan.

The main pattern is **case-sensitive on purpose** so identifiers (`AstridEmptyState`,
`astridPhrase`, `astrid-signed`) are not flagged. That is exactly why `<h1>astrid</h1>`
once survived every sweep and shipped an Astrid wordmark on a partner's sign-in page —
hence the separate JSX-text pattern. When adding a rule here, plant a violation and
confirm it fires: a rule that is green because its grep is malformed is worse than none.
