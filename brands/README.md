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
