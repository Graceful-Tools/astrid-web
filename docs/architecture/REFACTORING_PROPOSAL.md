# Refactoring Priorities

This active document records current direction, not frozen measurements. The
original 2024 proposal and its 2026 point-in-time review are preserved at
[`docs/archive/REFACTORING_PROPOSAL_2024.md`](../archive/REFACTORING_PROPOSAL_2024.md).

## Reproduce the current measurements

```bash
npm run docs:metrics
npm run check:reuse
```

`docs:metrics` derives file sizes, direct Prisma reach, client API helper use,
raw API fetches, and direct-re-export legacy/v1 route pairs from the current checkout.
Use `npm run docs:metrics -- --json` for machine-readable output. Do not copy
those changing counts into planning documentation.

The route-pair classification is a coarse structural signal, not proof that two
handlers behave differently. Manually compare contracts and tests before
consolidating a pair.

## Current priorities

1. **Keep legacy and v1 behavior behind shared implementations.** A v1 route may
   adapt authentication or envelopes, but duplicated business logic must move to
   a shared module or a direct re-export where contracts permit it.
2. **Use the client API and envelope helpers.** Prefer `lib/api.ts` and
   `lib/v1-response.ts` over hand-built fetch/unwrap behavior.
3. **Reduce boundary type erosion.** Validate request bodies and response
   envelopes; do not introduce `any` at API boundaries.
4. **Extract services for repeated business rules, not line-count targets.**
   Direct Prisma reach and large files are discovery signals. Split only around
   coherent responsibilities with tests that preserve behavior.

## Completion rule

Refactors follow the workflow in [`ASTRID.md`](../../ASTRID.md): establish
coverage, preserve behavior, run the task-appropriate checks, and keep canonical
documentation current. Testing policy lives in
[`docs/context/testing.md`](../context/testing.md); gate definitions live in
[`docs/CLI_OPERATIONS.md`](../CLI_OPERATIONS.md#4-quality-gates).
