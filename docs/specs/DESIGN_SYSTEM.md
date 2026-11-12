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
             design/assets/ ────┘                                ├─ web/astrid-tokens.css
             (checkbox, agent marks,                             ├─ web/checkbox-art.json
              manifest.json)                                     ├─ apple/AstridTokens.swift
                                                                 ├─ apple/AstridDesign.xcassets
                                                                 ├─ android/drawable/
                                                                 ├─ windows/AstridCheckbox.xaml
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
| **Brand** | accent, accent hover, text on accent, the accent as text (`accent-ink`, and `accent-ink-dark` for dark themes) | A partner build replaces these in every theme at once. On web they arrive as `--brand-*-rgb`; web works a partner's two inks out from its one accent (`lib/brand/css-vars.ts`). |
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
   register says so and the tokens take that value; iOS then follows. Three are recorded
   today: Ocean's darker text (web, AWTD-1496), the repeat frame around someone else's
   photo (web, AWTD-1571) and a darker or lighter shade for a status or brand colour drawn
   as text (web, AWTD-1575; register DS25). One value was decided in the tokens for every
   client at once: the accent and the error red were darkened so a button's label reads
   (Jon, 2026-11-11; register DS26).
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
- body text under 4.5:1 on the theme's own page;
- an ink (`accent-ink`, `error-ink` …) under 4.5:1 on the theme's card, on `bg-secondary`
  or on its own wash.

The brand accent is separate from the theme, so a partner's colour and a new theme do
not multiply. A theme a partner wants for itself is still an entry in the same file.

## Component specs

What each shared component looks like, in tokens. The core says which one to draw.

### Priority

Four values, one colour each: `priority-none`, `priority-low` (the brand accent; in Dark
its lighter shade, because the accent that carries a white label is 2.84:1 on a dark
card, register DS26), `priority-medium`, `priority-high`. Glyphs `○ ! !! !!!`. The same colour in the row, the
pickers, filters and headers.

### Leading control

[PRODUCT_CONTRACT.md §4](../PRODUCT_CONTRACT.md) decides the mark. Its look:

- A square of `size.leading-control`, radius `lg`, a 2 pt border in the priority colour.
- **A repeating task wears the repeat arrows.** Your own checkbox is the arrows. Someone
  else's photo and the unassigned mark keep the square's size and shape, and the arrows
  are drawn as its border in place of the priority outline, in the priority colour:
  `repeat-frame-scale` (1.0) × the square, the photo or "U" inside at
  `repeat-frame-inner-scale` (1.0), so a repeating task's face is as big as every other
  face in the column (register DS6; iOS AITD-612, web AWTD-1579).

### Selection

The selected row and anything that belongs to it wear one outline, the Mac's (Jon,
2026-11-10): the accent at `state.selection-outline-opacity` (55%),
`size.selection-outline` wide (1.5 where there is a pointer, 2.5 on touch), drawn inside
the edge so selecting moves nothing. No glow and no heavier shadow. Web defines it once
(`--selection-outline-*` in `styles/components.css`) for the row, the pane and its arrow.
The accent as a line is `border-focus`: the accent in Light and Ocean, its lighter shade
in Dark (register DS26), so that is the colour the outline reads.

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

Web differs on one of these today (row height 64): register DS14. Corner radii are the
tokens' by kind and density (`--row-radius`, `--board-card-radius`, `--board-column-radius`,
`--detail-panel-radius` in `styles/components.css`: compact where there is a pointer,
comfortable on touch, like the selection outline; DS13, AWTD-1617). The detail icon column is the token's 62 (16 + 34 + `gap-row-gap`, DS11)
and a subtask indents `layout.subtask-indent` per depth (`lib/design/subtask-indent.ts`,
DS12), both since AWTD-1617. Its `border` is the hairline (DS20, AWTD-1617):
`--hairline-width` in `styles/components.css`, the token on a high-density screen and
1px where half a pixel cannot be drawn. The leading control
itself is the token's 34 (`w-leading-control h-leading-control`, or
`LEADING_CONTROL_SIZE` where a number is needed), so the icon column is 16 + 34 + 12.

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
  with no duration rather than a design value. Five remain in components
  (`duration-300` and the like). iOS writes several springs out too.

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
| Completed | title struck through in muted text; the mark at `state.completed-mark-opacity` (0.5). The row itself is not dimmed (web since AWTD-1617, DS18) |
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

## Palette classes to theme classes

Web still writes Tailwind palette classes (`text-gray-400`, `bg-blue-600`) in `app/` and
`components/`: each restates a colour the tokens hold, and most were drawn for one theme.
This is what each becomes. The names are Tailwind theme colours wired to the tokens
(`lib/design/tailwind-theme.ts`, spread into `tailwind.config.ts`), so every one takes
`hover:`, `focus:`, `focus-visible:`, `active:`, `disabled:`, `group-hover:`, a
breakpoint and an opacity modifier (`bg-danger/90`) with no rule written for it, and
`cn()` resolves two of them on one element by order, as it does palette classes.
`tests/styles/design-tokens.test.ts` compiles each through the real config and follows it
to a colour in Light, Dark and Ocean.

A `dark:` pair becomes one class: the token already differs by theme. An arbitrary form
(`text-[rgb(var(--theme-accent))]`) is not a replacement; it is a hand-written value and
has a name below.

### The vocabulary

| Meaning | Class | Token |
|---|---|---|
| Text: primary, secondary, muted | `text-theme-primary`, `text-theme-secondary`, `text-theme-muted` | `text-primary`, `text-secondary`, `text-muted` |
| Text on the opposite surface; on a selected row | `text-theme-inverted`, `text-theme-selected` | `text-inverted`, `text-selected` |
| Placeholder | `placeholder:text-theme-placeholder` | `input-placeholder` |
| The page | `bg-theme-primary` | `bg-primary` |
| A card, dialog or menu on the page | `bg-theme-surface` | web-only `--theme-surface` |
| Secondary and tertiary surfaces | `bg-theme-secondary`, `bg-theme-tertiary` | `bg-secondary`, `bg-tertiary` |
| Hover, pressed, selected | `hover:bg-theme-hover`, `active:bg-theme-active` or `bg-theme-active`, `bg-theme-selected` | web-only `--theme-surface-hover`, `bg-active`, `bg-selected` |
| An input; a neutral button and its hover; the header | `bg-theme-input`, `bg-theme-button`, `hover:bg-theme-button-hover`, `bg-theme-header` | `input-bg`, `button-bg`, `button-hover`, `header-bg` |
| Border: default, heavier | `border-theme`, `border-theme-strong` (also `divide-theme`, `divide-theme-strong`) | `border`, `border-hover` |
| Border around a card, dialog or menu | `border-theme-surface` | web-only `--theme-surface-border` |
| Border: input, button, header, focus, selected | `border-theme-input`, `border-theme-button`, `border-theme-header`, `border-theme-focus`, `border-theme-selected` | `input-border`, `button-border`, `header-border`, `border-focus`, `bg-selected-border` |
| Brand accent as text, a link or an icon | `text-brand` | `accent-ink` |
| Brand accent: fill, text on the fill, border, a wash | `bg-brand`, `text-brand-foreground`, `border-brand`, `bg-brand-subtle` | `accent`, `accent-text` |
| Brand accent as a ring | `ring-brand`, `focus:ring-brand` | `border-focus` |
| Brand accent under the pointer | `hover:bg-brand-hover`; `hover:text-brand-hover` | `accent-hover`; as text, `accent-ink` |
| Danger: text or an icon; wash, fill, text on the fill, border | `text-danger`; `bg-danger-subtle`, `bg-danger`, `text-danger-foreground`, `border-danger` | `error-ink`; `error` |
| Success | `text-success`; `bg-success-subtle`, `bg-success`, `text-success-foreground`, `border-success` | `success-ink`; `success` |
| Warning | `text-warning`; `bg-warning-subtle`, `bg-warning`, `text-warning-foreground`, `border-warning` | `warning-ink`; `warning` |
| Info | `text-info`; `bg-info-subtle`, `bg-info`, `text-info-foreground`, `border-info` | `info-ink`; `info` |
| Overdue | `text-overdue` | `overdue` |
| Behind an agent's message | `bg-agent-bubble` | `agent-bubble` |
| A list colour fixed in the markup | `bg-list-1` … `bg-list-8` | `palette.list` |
| Disabled; a completed mark; a press | `disabled:opacity-disabled`, `opacity-completed`, `active:scale-press` | `state.disabled-opacity`, `state.completed-mark-opacity`, `state.press-scale` |
| The leading control's size | `w-leading-control h-leading-control` | `size.leading-control` |
| Priority | `lib/design/priority.ts` | `priority-*` |

The brand, status, overdue, agent and list names are plain colours and work on any colour
utility: `from-brand`, `border-l-warning`. A softer border or a pressed fill
is an opacity modifier on the same name (`border-danger/30`, `hover:bg-danger/90`), not a
second colour.

**A fill that carries a label is dark enough for it** (AWTD-1575, register DS26; Jon,
2026-11-11). The accent, its hover and the error red are buttons, and white on them is
5.17:1, 6.70:1 and 4.83:1 in every theme (`tests/styles/fill-label-contrast.test.ts`;
astrid-core's generator refuses less than 4.5:1). A fill that dark is 2.84:1 as a line on
Dark's card, so **the accent as a ring is the focus border**: `ring-brand` and shadcn's
`ring-ring` read `border-focus`, which is the accent in Light and Ocean and its lighter
shade in Dark. `border-brand` stays the accent, because it is mostly the edge of a
`bg-brand` fill; where it is a line by itself on a dark surface, use
`border-theme-focus`. A disabled brand button is `bg-brand` under
`disabled:opacity-disabled`, with no second fill.

**A meaning as text reads its ink** (AWTD-1575, register DS25). `accent`, `error`,
`success`, `warning` and `info` are one colour each in every theme: the colour of a fill,
which does not read as text everywhere (the accent is 2.84:1 as a link on Dark's card, a
green or amber label about 2:1 on its own wash in Light). Each has an ink, darker in Light and Ocean and lighter in Dark, at 4.5:1 or
better on the card and on its own wash. The utilities that draw a glyph read it: `text-*`,
and `fill-*` and `stroke-*` for an icon (`fill-danger`). Everything else (`bg-*`,
`border-*`, `ring-*`, `bg-*-subtle`) reads the base colour, bar `ring-brand` above, and `text-*-foreground` is
still the text on the fill. `hover:text-brand-hover` is the ink as well: the tokens have no
ink for a link under the pointer, and `accent-hover` is a fill that would fade a link in
Dark. shadcn's `text-destructive` is the error ink.

Rules that come with it:

- **Same meaning as the hand-written class, turned round.** `theme-text-muted` is
  `text-theme-muted`, `theme-bg-secondary` is `bg-theme-secondary`, `theme-border` is
  `border-theme`, `theme-surface` is `bg-theme-surface`; the test holds each pair to one
  colour. The hand-written ones stay valid where they are.
- **Never both spellings for one property on one element.** A hand-written `theme-*`
  class is two classes deep (`.light .theme-text-muted`) and loads after Tailwind, so it
  beats any variant: `theme-text-muted hover:text-danger` never turns red, as
  `theme-text-muted hover:text-red-500` never did. Convert the base with the variant:
  `text-theme-muted hover:text-danger`.
- **`brand` is the accent, `accent` is not.** `bg-accent` and `text-accent-foreground`
  are shadcn's hover grey. shadcn's own names (`bg-background`, `text-muted-foreground`,
  `border-input`, `bg-destructive` …) read the same tokens now and belong to
  `components/ui`; outside it, write the names above.
- **Ocean's `border-theme` is the page's cyan**, as `theme-border` is. Around something
  white use `border-theme-surface`; for a rule inside one, `border-theme-strong`.
- **A wash is not a surface.** `bg-danger-subtle` is the colour at
  `--theme-wash-opacity`, so what is under it shows. Put it on a surface, and on a
  floating panel give the panel `bg-theme-surface` and a status border instead.
- **Body text on a wash is `text-theme-primary`.** The status colour (`text-danger`, its
  ink) is for the icon, the heading or a short label; it is 4.5:1 or better on its own wash.
- **Never a status text colour on a status fill.** `text-danger` on `bg-danger` or on a
  `variant="destructive"` button is red on red. On a fill the text is `text-*-foreground`,
  or the button variant's own. A hover that swaps the fill for a wash swaps the text with
  it: `hover:bg-danger-subtle hover:text-danger`. `tests/styles/status-colour-uses.test.ts`
  scans for it.
- **A placeholder on anything but an input's own fill is `placeholder:text-theme-muted`.**
  `input-placeholder` is drawn for `bg-theme-input`; on `bg-theme-tertiary` it is 2.3:1 in
  Light.

### The sixty most common, and what each becomes

Counted over `app/`, `components/`, `hooks/` and `contexts/` (1,543 in all, 311 distinct).
An unpaired grey from the dark end (`bg-gray-800`, `text-gray-300`) was written for Dark
only; it takes the same row as its pair and the component then follows the theme, which is
the fix.

| Palette class (uses) | Becomes |
|---|---|
| `text-gray-900` (19), `text-gray-800` (4), `text-gray-900 dark:text-gray-100`, `text-gray-800 dark:text-gray-200`, `text-white` on a dark-only surface | `text-theme-primary` |
| `text-gray-700` (10), `text-gray-300` (31), `text-gray-700 dark:text-gray-300`, `dark:text-gray-200` (6) | `text-theme-secondary` |
| `text-gray-600` (22), `text-gray-500` (20), `text-gray-400` (77), `text-gray-500 dark:text-gray-400`, `text-gray-600 dark:text-gray-400`, `dark:text-gray-400` (13) | `text-theme-muted` |
| `placeholder-gray-400` (6) | `placeholder:text-theme-placeholder` |
| `bg-gray-900` (24), `bg-white dark:bg-gray-900` as the page | `bg-theme-primary` |
| `bg-gray-800` (42), `dark:bg-gray-800` (13), `bg-white dark:bg-gray-800` as a card, dialog or menu | `bg-theme-surface` |
| `bg-gray-50` (11), `bg-gray-50 dark:bg-gray-800/50` | `bg-theme-secondary` |
| `bg-gray-100` (9), `bg-gray-700` (14), `dark:bg-gray-700` (13), `bg-gray-100 dark:bg-gray-700` | `bg-theme-tertiary` |
| `bg-gray-200` (12), `bg-gray-300` (8), `dark:bg-gray-600` (7), `bg-gray-200 dark:bg-gray-700`, `bg-gray-300 dark:bg-gray-600` | `bg-theme-active` |
| `hover:bg-gray-700` (9), `hover:bg-gray-100` (5), `hover:bg-gray-100 dark:hover:bg-gray-800` | `hover:bg-theme-hover` |
| `border-gray-200` (16), `border-gray-600` (17), `border-gray-700` (6), `border-gray-800` (15), `dark:border-gray-700` (6), `border-gray-200 dark:border-gray-700` | `border-theme`; around a card, dialog or menu `border-theme-surface` |
| `border-gray-300` (7), `dark:border-gray-600` (7), `border-gray-300 dark:border-gray-600` | on an input `border-theme-input`; elsewhere `border-theme-strong` |
| `text-blue-500` (54), `text-blue-400` (29), `text-blue-600` (22), `dark:text-blue-400` (16), `text-blue-600 dark:text-blue-400`, `text-blue-700` (8), `dark:text-blue-300` (6) | `text-brand` |
| `hover:text-blue-400` (6), `hover:text-blue-300` | `hover:text-brand-hover` |
| `text-blue-800` (7), `text-blue-800 dark:text-blue-200` (text on a blue wash) | `text-theme-primary` |
| `bg-blue-600` (42), `bg-blue-500` (13), with `text-white` | `bg-brand text-brand-foreground` |
| `hover:bg-blue-700` (36), `hover:bg-blue-600` (5) | `hover:bg-brand-hover` |
| `bg-blue-50` (18), `dark:bg-blue-900/20` (13), `bg-blue-100` (5), `bg-blue-500/10` (6), `bg-blue-500/20` (6), `bg-blue-50 dark:bg-blue-900/20` | a selected item `bg-theme-selected`; a notice `bg-brand-subtle` |
| `border-blue-500` (18), `border-blue-600` (11) | `border-brand` |
| `border-blue-500/30` (8), `border-blue-200` (5), `border-blue-200 dark:border-blue-800` | around a selected item `border-theme-selected`; around a notice `border-brand/30` |
| `focus:ring-blue-500` (9), `ring-blue-500` (4) | `focus:ring-brand`, `ring-brand` |
| `text-red-500` (41), `text-red-400` (28), `text-red-600` (16), `text-red-600 dark:text-red-400` | `text-danger` |
| `hover:text-red-300` (9), `hover:text-red-400`, `hover:text-red-600` | `hover:text-danger` |
| `fill-red-500` (6) | `fill-danger` |
| `bg-red-50` (6), `bg-red-900/20` (6), `bg-red-500/10` (4), `bg-red-50 dark:bg-red-900/20` | `bg-danger-subtle` |
| `bg-red-600` (5) with `hover:bg-red-700` (5) and `text-white` | `bg-danger hover:bg-danger/90 text-danger-foreground` |
| `border-red-600` (6), `border-red-500` (4) | `border-danger` |
| `border-red-200` (4), `border-red-200 dark:border-red-800` | `border-danger/30` |
| `text-green-500` (56), `text-green-600` (9), `text-green-400` (8), `text-green-700` (5), `text-green-600 dark:text-green-400` | `text-success` |
| `bg-green-600` (8) with `hover:bg-green-700` (6) and `text-white` | `bg-success hover:bg-success/90 text-success-foreground` |
| `bg-green-500/20` (6), `bg-green-100` (5), `bg-green-50` (4), `bg-green-500/10` (4) | `bg-success-subtle` |
| `border-green-500` (6), `border-green-600` (4) | `border-success`; `border-green-200`, `border-green-500/30` are `border-success/30` |
| `text-green-800` (4), `text-red-800` (4), `text-yellow-800` (3), `text-orange-800` (3) and their `dark:…-200` pairs (text on a wash) | `text-theme-primary` |
| `text-yellow-500` (17), `text-yellow-600` (10), `text-yellow-400` (8), `dark:text-yellow-400` (7), `text-orange-500` (15), `text-orange-400` (5), `text-yellow-600 dark:text-yellow-400` | `text-warning`; if it is a priority, `priorityTextClass()` |
| `border-yellow-500` (5), `border-yellow-600` (4), `bg-yellow-500/20` (4), `bg-yellow-50` (3) | `border-warning`, `bg-warning-subtle` |
| `text-cyan-500` (7) | `text-info` |
| `bg-purple-100` (5), `bg-purple-100 dark:bg-purple-900/30` behind an agent | `bg-agent-bubble` |
| `text-purple-500` (21), `text-purple-600` (7), `text-purple-400` (4) | no token: see below |

### Where the token is not the colour that was written

Moving to a token changes what is drawn. These are the differences to expect, and they are
the point:

- The accent is `blue-600` with `blue-700` under the pointer, so a `bg-blue-600
  hover:bg-blue-700` button is the colour it was, and follows a partner's brand. It was
  `blue-500` and `blue-600` until 2026-11-11, when white on it was 3.68:1 and on the
  error red 3.76:1; the fills are the shared tokens, so they were darkened there for
  every client (register DS26).
- A status fill is one colour per status in every theme: `red-600`, `green-500`,
  `amber-500`, `cyan-500`. Yellow and orange both become the warning amber.
- Status and brand text is the ink: `blue-700`, `red-700`, `green-700`, `amber-700` and
  `cyan-700` in Light and Ocean, `blue-400`, `red-400`, `green-400`, `amber-400` and
  `cyan-400` in Dark. `text-red-600` gets one step darker (it was 4.14:1 on its own wash);
  `text-blue-500` and `text-green-500` on a light surface get darker and readable.
- Muted text is `gray-500` in Light and `gray-600` in Ocean, so a bare `text-gray-400`
  gets darker there.

### No honest token

Leave these, or change them as said; do not pick the nearest name.

| Usage | What to do |
|---|---|
| Purple for an agent's icon or label (`text-purple-500`) | The tokens hold only `agent-bubble`. Leave the palette class until astrid-core has an agent text colour; the wash behind is `bg-agent-bubble` |
| A list's colour chosen by the person | A `style` prop from `lib/brand/colors.ts` (the eight are `palette.list`); `bg-list-N` only where the markup fixes which one |
| Text on a status fill | `text-danger-foreground` and the others read the accent's text colour: the tokens have none of their own. White on the warning amber is 2.1:1; prefer a wash with `text-theme-primary` for a warning |
| Dark red or green text on a pale wash (`text-red-800` on `bg-red-50`) | A sentence is `text-theme-primary` on the wash; the icon, the heading or a short label is the status ink (`text-danger`). Priority glyphs have no ink yet (register DS22) |
| Third-party marks and their brand colours (Google, Apple, GitHub in `components/ui/brand-icons.tsx`), illustrations | Stay literal. They are someone else's colours |
| The checkbox art | astrid-core's shared art (`design/assets/checkbox`, AWTD-1605), drawn by `components/task-checkbox-art.tsx` from `packages/astrid-design/checkbox-art.json`: the box and arrows in the priority colour, the check in `checkbox-check`. Never redraw it here |
| A surface that is dark in every theme by design (a code block, the 404 page) | Stays literal, with a comment saying it is meant |
| `bg-black/50` scrims, `text-white` over a photo | Not palette classes and not counted; leave them |
| Charts | `chart-1` … `chart-5` read the list palette |

## In this repo

| What | Where |
|---|---|
| The vendored tokens | `packages/astrid-design/` (`astrid-tokens.css`, `tokens.resolved.json`, `REVISION`) |
| The vendored shared art | `packages/astrid-design/assets/` (the checkbox SVGs, the agent marks, `manifest.json`) and `checkbox-art.json`, hash-checked by `tests/styles/design-assets.test.ts` |
| Moving the pin | `scripts/sync-design-tokens.sh --rev <astrid-core sha>` |
| Theme variables | `styles/themes/*.css`: every `--theme-*` is a token, directly or through another theme variable. The web-only surfaces are named there once (below) |
| Classes | `lib/design/tailwind-theme.ts`, spread into `tailwind.config.ts`: the theme vocabulary, the inks for text and icons, shadcn's colours, the motion utilities and the leading control's size, each a token |
| shadcn's variables | `app/globals.css`: `--background`, `--primary` and the rest are tokens, declared once for every theme |
| Priority | `lib/design/priority.ts`, classes in `styles/components.css` |
| Values as data | `lib/design/tokens.ts` |
| The gate | `tests/styles/design-tokens.test.ts`: the copy is unedited, CSS and data agree, no colour is written out in a theme stylesheet, and every class and shadcn variable compiles and resolves to a colour in each theme. `tests/styles/motion-tokens.test.ts` does the same for durations |

### Web-only surfaces

The tokens have no name for these yet (register DS9). Each is a `--theme-*` variable that
reads a token, per theme, so none is a colour written out; the card glass rules take
their colour from these and write only how much shows through.

| Variable | Light | Dark | Ocean |
|---|---|---|---|
| `--theme-surface`: a card, dialog or menu | `bg-primary` | `bg-secondary` | `bg-hover` (the white; the page is cyan) |
| `--theme-surface-hover` | `bg-tertiary` | `bg-tertiary` | `bg-tertiary` |
| `--theme-surface-border`: the line around one | `border` | `border` | `bg-active` (the grey; the border is cyan) |
| `--theme-sidebar-bg`, `--theme-sidebar-border` | `bg-secondary`, the surface border | same | same |
| `--theme-panel-bg`, `--theme-panel-border`, `--theme-panel-arrow` | the surface, its border | same | `bg-secondary`, the surface border |
| `--theme-comment-bg` | `bg-secondary` | `bg-tertiary` | `bg-secondary` |
| `--theme-pill-bg`, `--theme-count-bg` | `bg-tertiary` | not drawn | not drawn |
| `--theme-shadow-sm`, `--theme-shadow`, `--theme-shadow-lg` | `shadow.sm`, `shadow.md`, `shadow.lg` | same | same |

Two more are numbers rather than colours, in `styles/components.css`:
`--theme-wash-opacity` (how strong `bg-danger-subtle` and the other washes are) and
`--motion-spring-ease` (the curve that stands in for a spring). Ocean borrowing `bg-hover`
and `bg-active` for a card and its border is the clearest case for a `surface` and a
`surface-border` token in astrid-core.

### The ratchet

`npm run check:design` counts the places where a value with a shared home was typed out
instead: palette classes, hex and rgb colours, theme triplets, inline styles, arbitrary
sizes, durations, and sentences in JSX (total and distinct). A count may not rise above
`tests/rules/design-metrics.budget.json`, and Vitest runs the same check, so `predeploy`,
CI and every agent workflow fail on a regression (predeploy and CI also run
`check:design` as its own named step). Budgets only go down: after a
reduction, `npm run design:metrics -- --update` in the same change.

| Count | Before tokens (main `e770865b`) | Now (2026-11-12) |
|---|---|---|
| Palette classes | 1,631 | 197 |
| Hex colours | 126 | 105 |
| rgb literals | 101 | 9 |
| Theme triplets | 119 | 0 |
| Inline styles | 64 | 56 |
| Arbitrary sizes | 97 | 96 |
| Durations | 57 | 4 |
| Sentences in JSX | 999 | 438 |
| Distinct sentences in JSX | 802 | 399 |

What moved, what is left and why, and the ranked follow-ups are in
[DESIGN_AUDIT_2026-11.md](./DESIGN_AUDIT_2026-11.md).

astrid-core's `cargo xtask check-design` compares this repo's copy with its own at the
pinned revision, in its CI.

## Not built yet

- **Literal ratchet on the other clients.** Web has one (below). iOS has
  `check-brand.sh` and Windows a radius test to grow from; Android has none.
- **Reference screenshots.** A fixed set of screens in each theme, captured per client
  and set side by side.
- **Shared assets on the native clients.** astrid-core generates the checkbox for Apple,
  Android and Windows (AWTD-1605); until each draws it, it keeps its copies of the sixteen
  images (register DS21).
- **Icon map.** One meaning to one glyph per platform (SF Symbols, lucide, Segoe,
  Material).
- **Shared copy.** Web's keys and the core's label keys exported from one place.
