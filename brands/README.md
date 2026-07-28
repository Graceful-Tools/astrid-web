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
