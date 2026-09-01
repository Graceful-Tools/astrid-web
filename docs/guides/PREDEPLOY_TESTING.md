# Predeploy Testing & Quality Gates

The authoritative command definitions and selection rules live in
[`docs/CLI_OPERATIONS.md` §4](../CLI_OPERATIONS.md#4-quality-gates). Testing
policy, test locations, and when to add coverage live in the
[testing strategy](../context/testing.md).

This file is retained as a discoverable pointer for older links. Do not copy the
current command composition or test counts here; `package.json` and
`scripts/predeploy-self-healing.ts` are executable, and `npm run check:docs`
guards the canonical documentation.
