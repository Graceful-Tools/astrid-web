# Spec: the Astrid design system

*Spec of record for how Astrid looks on every client: iOS, Mac, web, Android, Windows and
VS Code.*

Status: **decided, partly built.** The token source, its generator and its checks are in
astrid-core. Web reads its theme colours and priority colours from the vendored copy. The
other clients adopt through the tasks on their boards; what each still differs on is the
register in astrid-core's
[`design/README.md`](https://github.com/Graceful-Tools/astrid-core/blob/main/design/README.md).

> The ask, in Jon's words (2026-11-10): *"Use the iOS and Mac app as the basis and define a
> design system that helps drive the design consistency similar to how the astrid-core
> drives consistency of data, logic."*

---

## The problem this ends

Behaviour has one source. Web's rules generate fixtures, astrid-core replays them, the
clients pin the core, and disagreements are numbered. Appearance had none. Android copied
`Theme.swift`, Windows copied this repo's theme stylesheets, this repo had three colours
for medium priority, and each copy was kept alike by a comment saying "matches iOS".
Nothing failed when one moved.

## How it works

One file, astrid-core's `design/tokens.json`, holds the values. `cargo xtask gen-design`
writes each platform's own kind of resource from it. A client vendors the generated file
at a named revision and never edits it.

```
astrid-ios (iOS + Mac)  ── the reference: a design change starts here
        │
        ▼
astrid-core  design/tokens.json ──▶ cargo xtask gen-design ──▶ design/generated/
                                                                 ├─ web/astrid-tokens.css
                                                                 ├─ apple/AstridTokens.swift
                                                                 └─ tokens.resolved.json
        │ vendored at a revision, checked in each client's gate
        ▼
astrid-web  packages/astrid-design/        astrid-ios, astrid-android, astrid-windows: as adopted
```

Nothing is linked into the core at run time. The core decides which theme is chosen
(`astrid_rules::theme`) and what a row draws (the leading control, the board columns).
The tokens decide what that looks like.

## What is in it

| Layer | Holds | Notes |
|---|---|---|
| **Brand** | accent, accent hover, text on accent | A partner build replaces these in every theme at once. On web they arrive as `--brand-*-rgb`. |
| **Themes** | every surface, border, text, status, input, button and priority colour, per theme | `light`, `dark`, `ocean`. Each theme answers for the same names. |
| **Palettes** | the eight list colours, the five trade-off ratings | Choices, not brand values. |
| **Scales** | spacing 2-48, radius 6/8/12/16, three shadows | Already equal on iOS, Android and Windows. |
| **Type** | sizes and weights, per density | `comfortable` for touch, `compact` for pointer-driven desktops. |
| **Motion** | hover, press, fast, medium, panel, drawer, and three springs | The Mac's values, iOS's springs, and the two curves the web already animates with. |
| **Sizes** | shared control sizes per density, the repeat-frame scale, hit target, hairline | |
| **Layout** | row height, padding and radius, the detail icon column, subtask indent, breakpoints, per density | The rules that keep things aligned. |
| **States** | disabled and completed opacity, press scale, the drawer's geometry | |

## Rules

1. **iOS and Mac are the reference.** A design change is made there first, then in
   `tokens.json`, then each client re-vendors. Where another client was right, the
   register says so and the tokens take that value; iOS then follows. Two are recorded
   today: Ocean's darker text (web, AWTD-1496) and the repeat frame around someone else's
   photo (web, AWTD-1571).
2. **A shared value is never restated.** Not as a literal in a view, not as a second
   table. In this repo: `var(--astrid-*)` in CSS, `lib/design/priority.ts` for priority,
   `lib/design/tokens.ts` where CSS cannot reach.
3. **A platform may add, not change.** It may add a token only it needs, pick the
   density that fits its input, and use a native control where the toolkit has one. It
   may not give a shared token a different number. A difference is either a numbered row
   in the register or a bug.
4. **The core decides what, the tokens decide how.** No client works out for itself
   which control a row leads with; no client works out for itself what colour it is.
5. **VS Code is the stated exception.** It takes the editor's colours and only the
   product meanings: priority order, overdue, glyphs, copy.

## Theming

A theme is data: an entry under `themes` with its appearance and the theme it extends,
restating only what differs. Adding one is that entry plus its name in
`astrid_rules::theme::Theme`. The generator refuses:

- a theme the core cannot name, or a core theme with no colours;
- a colour name that one theme defines and another lacks;
- body text under 4.5:1 on the theme's own page.

The brand accent is separate from the theme, so a partner's colour and a new theme do
not multiply. A theme a partner wants for itself is still an entry in the same file.

## Component specs

What each shared component looks like, in tokens. The core says which one to draw.

### Priority

Four values, one colour each: `priority-none`, `priority-low` (the brand accent),
`priority-medium`, `priority-high`. Glyphs `○ ! !! !!!`. The same colour in the row, the
pickers, filters and headers.

### Leading control

[PRODUCT_CONTRACT.md §4](../PRODUCT_CONTRACT.md) decides the mark. Its look:

- A square of `size.leading-control`, radius `lg`, a 2 pt border in the priority colour.
- **A repeating task wears the repeat arrows as a frame**, `repeat-frame-scale` (1.25) ×
  the square, in the priority colour, with the photo or unassigned mark inside. This
  holds for all three marks. iOS draws a repeating task assigned to someone else at the
  wrong size; web's is right (register DS6).

### Selection

The selected row and anything that belongs to it wear one outline, the Mac's (Jon,
2026-11-10): the accent at `state.selection-outline-opacity` (55%),
`size.selection-outline` wide (1.5 where there is a pointer, 2.5 on touch), drawn inside
the edge so selecting moves nothing. No glow and no heavier shadow. Web defines it once
(`--selection-outline-*` in `styles/components.css`) for the row, the pane and its arrow.

### Task details panel

Where the list and the details share the screen, the details **open out of the selected
row**:

- the panel wears the same selection outline as the row, so the two read as one object;
- an arrow on the panel's leading edge points at the row and follows it over
  `motion.fast`;
- the panel enters and leaves over `motion.panel`.

The Mac and the web do this today. It belongs wherever the list and the details share
the screen: iPad, Windows, and two-pane Android (tablets, foldables and dual-screen
devices). A phone's single pane does not get it (Jon, 2026-11-10; register DS7).

## Layout and alignment

The rules the iOS and Mac apps already state or test, as `layout` and `size` tokens. A
rule is the sentence; the numbers differ by density and only by density.

| Rule | Comfortable (touch) | Compact (pointer) |
|---|---|---|
| **Field content starts under the title.** In task details, the icon column is as wide as the title's leading control and its gap. | 62 (16 + 34 + 12) | 29 (19 + 10) |
| A row is never shorter than its title, its meta line and its padding. | 76 | 52 |
| Row padding, and the gap between the leading control and the text. | 16 × 14, gap 12 | 12 × 9, gap 12 |
| A subtask indents by one step per depth, four deep at most. | 16 | 16 |
| Anything tappable is at least the hit target. | 44 | the row |
| Corner radius by kind: row, board card, board column, details panel. | 8, 8, 12, 16 | 8, 6, 8, 14 |
| A hairline is half a point. | 0.5 | 0.5 |
| Three columns from 1100 wide, measured on the window. | — | 1100 |
| Triggers size to their content; an unset field is an affordance to add one; one label per row. | [PRODUCT_CONTRACT §3](../PRODUCT_CONTRACT.md) | same |

Web differs on several of these today (icon column 58, indent 24, row and panel radius
12, row height 64, hairline 1 px): register DS11-DS14 and DS20. The leading control
itself is the token's 34 (`w-leading-control h-leading-control`, or
`LEADING_CONTROL_SIZE` where a number is needed), so the icon column is 16 + 34 + 8;
what is left of DS11 is the gap, 8 against the token's 12.

## Motion

Every animation names a `motion` token. A platform with springs uses the spring form and
a platform with curves the duration and curve; they are the same interaction.

| Interaction | Token |
|---|---|
| Pointer over a row or control | `hover` (100 ms ease-out) |
| Press | `press` (100 ms), to `state.press-scale` (0.98) |
| Small toggles, the details arrow following its row, drop targets | `fast` (150 ms ease-out) |
| Rows inserted, removed or reordered; switching list, board and chat; switching theme | `medium` (220 ms ease-in-out) |
| Expand and collapse; the checkbox | `spring` (280 ms, damping 0.85) |
| Task details opening and closing | `panel` (300 ms ease-out) or `panel-spring` (340 ms, 0.85) |
| The sidebar drawer | `drawer` (300 ms) or `drawer-spring` (250 ms, 0.85); the sidebar rises from 0.95 scale and 0.8 opacity, and the drawer is 85% of the screen |

**Completing a task** is the Mac's motion and iOS's haptic together (Jon, 2026-11-10): the
checkbox pops to `state.complete-pop-scale` (1.28) on `spring`, and the device taps back
where it can. Reopening does neither.

Two things are not done, and the register says so:

- **Reduced motion** (DS17). Every operating system has a setting for people who are
  made unwell by movement on screen. An app that honours it swaps a slide or a pop for a
  fade or nothing. Only web's checkbox pop checks it so far; every other animation on
  every client still plays.
- **Web's components do not read these yet** (DS15). Its stylesheets do: nothing in
  `styles/` or `app/globals.css` writes a duration out, bar one `0s` that is a switch
  with no duration rather than a design value. 28 remain in components
  (`duration-200` and the like). iOS writes several springs out too.

### Motion on web

A stylesheet names the token's custom properties; a component names the Tailwind utility
bound to the same token (`lib/design/tailwind-theme.ts`). A written-out duration is a
count in the ratchet.

| Token | In CSS | In a class |
|---|---|---|
| `hover` | `var(--astrid-motion-hover-duration) var(--astrid-motion-hover-ease)` | `duration-hover ease-hover` |
| `press` | `var(--astrid-motion-press-duration) var(--astrid-motion-press-ease)` | `duration-press ease-press` |
| `fast` | `var(--astrid-motion-fast-duration) var(--astrid-motion-fast-ease)` | `duration-fast ease-fast` |
| `medium` | `var(--astrid-motion-medium-duration) var(--astrid-motion-medium-ease)` | `duration-medium ease-medium` |
| `spring` | `var(--astrid-motion-spring-duration) var(--motion-spring-ease)` | `duration-spring` |
| `panel` | `var(--astrid-motion-panel-duration) var(--astrid-motion-panel-ease)` | `duration-panel ease-panel` |
| `drawer` | `var(--ios-drawer-duration) var(--ios-drawer-ease)`, which read the token | `duration-drawer ease-drawer` |

CSS has no spring, so `--motion-spring-ease` (`styles/components.css`) is the one curve
that overshoots and settles; it stands in for the tokens' damping. The spring forms of
`panel` and `drawer` are for platforms with springs; web uses their curve forms.

What a written-out value becomes:

| Written out | Token | Because |
|---|---|---|
| `duration-75`, `duration-100`, `0.1s` on a hover or a colour change | `hover` | pointer over a row or control |
| `0.06s`, `0.08s`, `0.1s` on a press, `active:scale-95` timing | `press` | press, to `state.press-scale` |
| `duration-150`, `0.15s`; the details arrow's `duration-75` | `fast` | small toggles, the arrow following its row, drop targets |
| `duration-200`, `0.2s`, `transition-theme` | `medium` | rows moving, switching list, board and chat, switching theme |
| `0.2s` on an accordion, `0.28s`, anything that expands or pops | `spring` | expand and collapse, the checkbox |
| `duration-300`, `0.3s`, `0.35s` on the details panel or a sliding pane | `panel` | task details opening and closing |
| `0.3s` on the sidebar drawer | `drawer` | the sidebar drawer |
| `duration-500` and longer, a spinner, a skeleton pulse | none | not an interaction in the table; say so in the change that keeps it |

Three things moved when the stylesheets adopted these, because the token differs from
what was written: a row's hover tint takes 100 ms, not 200; the phone's details panel
slides for 300 ms on ease-out, not 350 on a hand-made curve (the code that waits for it
reads `motion.panel` too); and the details arrow follows its row over 150 ms, not 75.

## States

| State | Rule |
|---|---|
| Disabled | `state.disabled-opacity` (0.5) |
| Completed | title struck through in muted text; the mark at `state.completed-mark-opacity` (0.5). Web also dims the whole row (DS18) |
| Selected | the selection outline; no fill change, no glow |
| Hover | the theme's hover surface |
| Row title | wraps without limit by default, as on iOS. An appearance setting, "Task titles", chooses wrap, two lines or one on every client, and is kept per machine like the theme (Jon, 2026-11-10; DS19). Web: `lib/design/row-title.ts` |

## Markdown

Descriptions, comments and chat draw the same markdown on every client; what it parses to
is the core's (`markdown.json`), and what is recognised as a Decision or a trade-off grid is
[PRODUCT_CONTRACT §8](../PRODUCT_CONTRACT.md) and [DECISIONS.md](../DECISIONS.md). This is
how it looks.

| Element | Rule |
|---|---|
| Links | the accent |
| Inline code and code blocks | a neutral wash behind monospace, radius `sm` or smaller |
| Blockquote | a `markdown.blockquote-bar` (3) bar in the hover border colour |
| Rule and table borders | the hover border colour, so they follow the theme |
| Task list | the checkbox replaces the bullet |
| **Trade-off grid** | each rated cell sits on its rating's fill (`palette.tradeoff`, worst to best: dark red, light red, yellow, light green, dark green) with that fill's text colour (`palette.tradeoff-text`: white on the two dark fills). The same five in every theme. Cells are `tradeoff-cell-min` to `tradeoff-cell-max` wide (84-150), separated by `tradeoff-gap` instead of grid lines, with radius `tradeoff-cell-radius`. The key under the grid shows a `tradeoff-swatch` square per rating used, named in words. The traffic-light emoji (🔴 🟡 🟢) are the same poor, mixed and good ratings and draw on the same fills |
| **Decision card** | radius `decision-card-radius` (10), a `decision-badge` (24) circle with the option's number in the accent, a 1 pt border that becomes 2 pt in the accent when chosen; cards that can no longer be chosen dim to `state.disabled-opacity` |

Web reads the rating fills and text from the tokens. Its gap (4), cell radius (6) and
swatch (12) differ from iOS's (register DS23), and heading sizes are not tokens yet (DS24).

### Still to write

Task row, sidebar row, board card, comment bubble, pickers, empty state. Each lands with
the web-only surfaces it needs (register DS9).

## In this repo

| What | Where |
|---|---|
| The vendored tokens | `packages/astrid-design/` (`astrid-tokens.css`, `tokens.resolved.json`, `REVISION`) |
| Moving the pin | `scripts/sync-design-tokens.sh --rev <astrid-core sha>` |
| Theme variables | `styles/themes/*.css`: every shared `--theme-*` is `var(--astrid-*)` |
| Priority | `lib/design/priority.ts`, classes in `styles/components.css` |
| Values as data | `lib/design/tokens.ts` |
| The gate | `tests/styles/design-tokens.test.ts`: the copy is unedited, CSS and data agree, no shared colour is written out |

### The ratchet

`npm run check:design` counts the places where a value with a shared home was typed out
instead: palette classes, hex and rgb colours, theme triplets, inline styles, arbitrary
sizes, durations, and sentences in JSX (total and distinct). A count may not rise above
`tests/rules/design-metrics.budget.json`, and Vitest runs the same check, so `predeploy`,
CI and every agent workflow fail on a regression. Budgets only go down: after a
reduction, `npm run design:metrics -- --update` in the same change.

| Count | Before tokens (main `e770865b`) | Now |
|---|---|---|
| Palette classes | 1,631 | 1,586 |
| Hex colours | 126 | 113 |
| rgb literals | 101 | 85 |
| Theme triplets | 119 | 35 |
| Inline styles | 64 | 64 |
| Arbitrary sizes | 97 | 97 |
| Durations | 57 | 57 |
| Sentences in JSX | 999 | 999 |
| Distinct sentences in JSX | 802 | 802 |

astrid-core's `cargo xtask check-design` compares this repo's copy with its own at the
pinned revision, in its CI.

## Not built yet

- **Literal ratchet on the other clients.** Web has one (below). iOS has
  `check-brand.sh` and Windows a radius test to grow from; Android has none.
- **Reference screenshots.** A fixed set of screens in each theme, captured per client
  and set side by side.
- **Shared assets.** The sixteen checkbox images and the agent marks are copied by hand
  into each client.
- **Icon map.** One meaning to one glyph per platform (SF Symbols, lucide, Segoe,
  Material).
- **Shared copy.** Web's keys and the core's label keys exported from one place.
