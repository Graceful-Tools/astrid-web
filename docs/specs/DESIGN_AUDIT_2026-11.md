# Design audit, November 2026: hand-written values on web, before and after

*AWTD-1575. Measured 2026-11-12 on main `1f0d80cb` with `npm run design:metrics`
(`scripts/report-design-metrics.ts`). The rules it checks against are
[DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) and the register in astrid-core `design/README.md`.*

Each count is a place where something that already has a shared home was typed out by hand:
a colour, a size, a duration, a sentence. The "before" numbers come from main `e770865b`
(2026-11-10), before web took on the design tokens.

## The numbers

| Count | Before (`e770865b`) | After (`1f0d80cb`) | Change |
|---|---:|---:|---:|
| Tailwind palette classes | 1,631 | 197 | −88% |
| Hex colours, code and stylesheets | 126 | 105 | −17% |
| rgb literals | 101 | 9 | −91% |
| Theme colour triplets written out | 119 | 0 | −100% |
| Inline `style={{ }}` props | 64 | 56 | −13% |
| Arbitrary sizes (`w-[37px]`) | 97 | 96 | −1% |
| Durations written out | 57 | 4 | −93% |
| Sentences typed into JSX | 999 | 438 | −56% |
| Distinct sentences typed into JSX | 802 | 399 | −50% |

This change lowers the budgets in `tests/rules/design-metrics.budget.json` to these counts.
Palette classes, durations and sentences had dropped since their budgets were last set.

## Count by count

### Palette classes: 1,631 → 197

**Moved:** colour classes became theme classes (`text-theme-muted`, `bg-brand`, `text-danger`,
and so on). Each is defined once from the tokens; the full list is in
DESIGN_SYSTEM.md → *Palette classes to theme classes* (PR #714). Status and brand text uses the
ink tokens (register DS25), and button fills use the darker accent and error colours (DS26,
PRs #716 and #730).

**Left, and why:** none of the 197 has a token to move to (DESIGN_SYSTEM.md → *No honest token*):
- Coloured tiles behind section icons in Settings: AppearanceSettings 33, SettingsHub 9,
  webhooks 24.
- The agent colour: `text-purple-*` appears 37 times.
- Surfaces that are dark in every theme on purpose: the attachment viewer (17), code blocks,
  the landing footer.
- Developer and internal pages: the astrid-coding page (17), the OAuth API tester (14).

Closing these needs a categorical palette and an agent ink colour in astrid-core first.

### Hex colours: 126 → 105

**Moved:** the digest email's overdue and due-today colours now come from the tokens (AWTD-1596);
the last restated blues and reds read the tokens (vendored astrid-core main); 404 page values
(AWTD-1599).

**Left, and why:** most of the rest is HTML for emails and server-rendered pages, which can't
read CSS variables: `lib/email-reminder-service.ts` 38, `lib/email.ts` 9, `lib/not-found-page.ts`
5, the unsubscribe route 4. `lib/placeholder-utils.ts` (16) draws placeholder art, and the admin
analytics charts use 9. **One budget was raised, on purpose:** the checkbox drawn from the
priority tokens (AWTD-1581) kept the art's green `#89a912`, which has no token yet (AWTD-1605).
That took the budget from 104 to 105, still under main's 108 at the time, and the commit
message gives the reason.

### rgb literals: 101 → 9, and theme triplets: 119 → 0

**Moved:** the web-only surfaces (sidebar, panel, pill, count badge, card glass) are now
variables that read a token. The theme stylesheets contain no colour written out (register DS9).

**Left:** 5 shadows in the email reminder service (email HTML again), 2 in `styles/components.css`
(the two directional shadows DS9 mentions: `shadow` has no direction), 1 in quick-add and 1 in
the unsubscribe route.

### Inline styles: 64 → 56

**Moved:** a few went with the token work and the branded 404 (AWTD-1599).

**Left, and why:** about 36 are values computed at run time, which is what a style prop is for:
a list or label colour someone chose, the priority colour, virtualizer sizes, pane positions,
the details panel arrow. About 8 are in `app/global-error.tsx`, which renders outside the root
layout, so app CSS isn't guaranteed there. About 12 are fixed values that should be classes
(`width: '33%'`, `maxHeight`, `zIndex: 9999`). The metric can't yet tell computed values from
fixed ones; the follow-up fixes that.

### Arbitrary sizes: 97 → 96

Not started. 15 are `[10px]` and 8 are `[12px]`, text sizes below the type scale. The rest are
popover and pane widths and 44 px touch targets (`size.touch-target` is the token for those).

### Durations: 57 → 4

**Moved:** the stylesheets animate with `var(--astrid-motion-*)`, and components use
`duration-fast`, `duration-panel` and the like (DESIGN_SYSTEM.md → *Motion on web*; register
DS15).

**Left:** `duration-500` twice in the empty state, `duration-300` in the PWA status, and `0s` in
`components.css`. The register still says five; it falls behind each time one is converted.

### Sentences in JSX: 999 → 438 (distinct: 802 → 399)

**Moved:** about 465 sentences on product screens became i18n keys in all twelve locales (PR #715).
The half-translated screens were then finished (PR #717). Legal pages now name the brand's
operator (AWTD-1584), and the 404 is localized (AWTD-1599).

**Left:**

| Where | Count |
|---|---:|
| Developer docs (`app/[locale]/docs/**`, `components/docs/`) | 194 |
| Internal tools (debug-reminders, admin, OAuth API tester, test-time-picker) | 137 |
| Help (`components/legal/HelpContent.tsx`) | 50 |
| Privacy and Terms | 48 |
| Product screens | 9 |

How these pages should be treated is Jon's decision, still open. The recommendation is to
translate Help, keep legal text and developer docs in English, and stop counting internal tools.
The count also misses copy that doesn't match its pattern (text built in code, toast
messages), so English seen on a German screen is checked separately (AWTD-1601).

## Against the register (astrid-core `design/README.md`)

Status of web's rows on 2026-11-12:

| Row | Status on web |
|---|---|
| DS4 leading control size | Closed: drawn from `size.leading-control` |
| DS5 selection outline | Takes the Mac's at the next vendored copy |
| DS9 web-only surfaces | Closed as far as web can go; two directional shadows still written out |
| DS11 detail icon column | Open: gap 8 against 12 |
| DS12 subtask indent | Open: 24 against 16 |
| DS13 corner radii | Open: rows, cards and panel all 12 |
| DS14 row height | Open: 64 at every width |
| DS15 motion | Stylesheets closed; 4 durations left in components (the register still says five) |
| DS16 completion pop | Takes it at the next vendored copy |
| DS17 reduced motion | Open: one guarded rule in `components.css`, none in components |
| DS18 completed row | Closed (AWTD-1617): the row is no longer dimmed |
| DS19 title wrap setting | Open: web takes it now |
| DS20 hairline | Closed (AWTD-1617): `border` is 0.5 on high-density screens |
| DS21 checkbox art | Accepted; drawn from the priority tokens since AWTD-1581 |
| DS22 priority glyphs as text | Open in core (text variants of the priority colours) |
| DS23 Decision grid | Open: gap, radius and swatch differ |
| DS24 Markdown headings | Open: sizes written out until they join `type` |
| DS25 / DS26 inks and fills | Adopted (PRs #716, #730) |

The ratchet can't see these rows: they're differences in layout, not hand-written values.

## How the workflows hold it

- **Vitest:** `tests/rules/design-metrics-ratchet.test.ts` fails when any count goes above its
  budget. It runs in `npm run test:run`, so in predeploy and in CI.
- **Predeploy** also runs `npm run check:design` as a separate *Design Consistency* step, after
  *Reuse First* and before Vitest. A regression is then reported by name in seconds, not as one
  failure among 3,000 tests, and a red Vitest step is usually written off as a load flake.
  `tests/scripts/predeploy-runs-check-design.test.ts` keeps the step in place.
- **CI:** the *Unit Tests* workflow (every PR, no path filter) has a *Design Consistency* step,
  and the `fixstuff.yml` dispatch runs it next to the reuse check.
- **Agent workflows:** docs/FIXALL_WORKFLOW.md step 8, docs/FIXALL_WEB.md *Gates*, and
  `.claude/commands/fixstuff.md` all name `npm run check:design`, with the rule that the count
  never rises and a budget is lowered in the same change that lowers its count.

## Follow-ups, most valuable first

1. **[design] The last 197 palette classes** (AWTD-1612): needs a categorical icon palette and
   an agent ink colour in astrid-core first.
2. **[i18n] The last 438 sentences** (AWTD-1613): translate Help; the rest depends on the open
   decision.
3. **[design] The 105 hex colours** (AWTD-1614): a token-backed palette module for email HTML
   and server-rendered pages.
4. **[design] The 96 arbitrary sizes** (AWTD-1615): move them onto the type, spacing and radius
   scales.
5. **[design] Inline styles, the last durations and rgb literals** (AWTD-1616): turn the fixed
   styles into classes and stop counting computed ones.
6. **[design] Web's open register rows** (AWTD-1617): DS11–DS14, DS17–DS20, DS23, DS24.
