# Code Reuse & Cross-Platform Consistency

This is the current reuse contract for Astrid Web. The original 2026-07-25
proposal has been implemented; mutable backlog counts and rollout phases are not
kept here.

## Canonical homes

| Concern | Canonical home | Required use |
|---|---|---|
| List/task permissions — **the rules** | `lib/list-permissions.ts` | Who may do what, and the Prisma clause that expresses it: `getUserRoleInList`, the `canUser*` predicates, `listVisibilityWhere()`. Never reproduce owner/admin role math, and never hand-roll a visibility `OR` |
| List/task permissions — **the roster** | `lib/list-member-utils.ts` | Turning a list payload into people: `getAllListMembers`, `getListMemberIds`, `hasListAccess`. Built ON TOP of the rules module, which it imports; it must never answer a permission question the rules module does not |
| User-facing copy | `lib/i18n/locales/*.json` | Use `t("...")`; shared Web/iOS wording also follows [`PRODUCT_CONTRACT.md`](./PRODUCT_CONTRACT.md) |
| List settings rendering | `components/TaskManager/MainContent/ListSettingsHost.tsx` | Keep layout variants behind the shared host |
| Cross-platform behavior | [`PRODUCT_CONTRACT.md`](./PRODUCT_CONTRACT.md) | Update the contract when permissions, shared copy, or shared interaction behavior changes |
| API wire behavior | [`API_CONTRACT.md`](./API_CONTRACT.md) | Update the stable contract instead of documenting shapes at call sites |

Thin compatibility re-exports are allowed when removing one would create noisy
consumer churn, but the implementation must remain in the canonical module.

**Do not give a local helper the name of an exported permission predicate.**
Three routes declared their own `canAccessList` while `lib/list-member-utils.ts`
exports one, and the two did not agree: the export returns true for ANY list
whose privacy is `PUBLIC`, the local copies checked membership only. So the
obvious tidy-up — delete the copies, import the shared one — would have widened
access to every public list with nothing going red (task 3baa6e7c). Import the
helper, or name yours after what it actually does.
`tests/rules/permission-helpers-are-not-shadowed.test.ts` enforces both this and
the hand-rolled-visibility rule.

## Enforcement

- `npm run check:reuse` is strict and fails on inline owner/admin checks,
  hardcoded add-task copy, and brand literals outside their canonical homes.
- ESLint's `no-restricted-syntax` rules are the machine-enforced source; the
  script is the human-readable rollup.
- `ASTRID.md` requires a reuse search before new helpers, keys, or components are
  introduced.
- `npm run check:docs` prevents competing canonical documentation headings and
  missing documentation-owner index entries.

## Reproduce the current state

Run these commands instead of copying counts into documentation:

```bash
npm run check:reuse
npm run docs:metrics
```

The first command reports current policy violations. The second derives
architecture/refactoring measurements from the checked-out tree. A zero-result
search is only evidence about the search performed, so inspect names and imports
before declaring an abstraction absent.

## Change checklist

1. Search for an existing helper, key, component, and contract before writing.
2. Add missing behavior to its canonical home rather than introducing a parallel
   implementation.
3. Update `PRODUCT_CONTRACT.md` when behavior or copy is shared with iOS/Mac.
4. Run `npm run check:reuse` and the task-appropriate gate from
   [`CLI_OPERATIONS.md`](./CLI_OPERATIONS.md#4-quality-gates).
