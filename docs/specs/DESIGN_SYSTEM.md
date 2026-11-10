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
| **Motion** | fast 150 ms, medium 220 ms, panel 300 ms, drawer 300 ms, spring | The Mac's values, plus the two the web already animates with. |
| **Sizes** | shared control sizes per density, the repeat-frame scale | |

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

The selected row and anything that belongs to it wear one outline: the accent,
`size.selection-outline` wide, drawn inside the edge so selecting moves nothing. No glow
and no heavier shadow.

### Task details panel

Where the list and the details share the screen, the details **open out of the selected
row**:

- the panel wears the same selection outline as the row, so the two read as one object;
- an arrow on the panel's leading edge points at the row and follows it over
  `motion.fast`;
- the panel enters and leaves over `motion.panel`.

The Mac and the web do this today. iOS (iPad and wider), Android and Windows adopt it
(register DS7). On a phone the details take the whole screen; what carries the outline
and motion there is settled in the iOS task.

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

astrid-core's `cargo xtask check-design` compares this repo's copy with its own at the
pinned revision, in its CI.

## Not built yet

- **Literal ratchet.** Each repo counts hardcoded colours, radii, font sizes and spacing
  in view code and fails when the count rises. Web has about 1,600 raw palette classes.
- **Reference screenshots.** A fixed set of screens in each theme, captured per client
  and set side by side.
- **Shared assets.** The sixteen checkbox images and the agent marks are copied by hand
  into each client.
- **Icon map.** One meaning to one glyph per platform (SF Symbols, lucide, Segoe,
  Material).
- **Shared copy.** Web's keys and the core's label keys exported from one place.
