# Decisions and trade-off grids

*How to ask a person to choose, so every Astrid app draws it as tappable cards and a coloured grid.*

The grid is a **traffic light**, from Jon Paris's Extreme Clarity training (Appendix 5,
[jon.paris/extremeclarity](https://jon.paris/extremeclarity)): criteria as lettered columns,
options as numbered rows including doing nothing, a concrete assessment and a colour in every
cell, and the recommendation stated first. *The method*, below, is the part people and agents
most often skip.

This is the one guide. The help page, the MCP tool descriptions, `/docs/mcp` and
[FIXALL_WORKFLOW.md](./FIXALL_WORKFLOW.md) summarise it and point here. The exact recognition rules,
which all three apps share, are in [PRODUCT_CONTRACT.md §8](./PRODUCT_CONTRACT.md). The example
below is also a contract fixture (`contracts/fixtures/decisions.json`), so web, iOS and Mac are
tested against the same text.

## The complete example

```markdown
We recommend Lisbon (#1), accepting a 9-hour travel day for the offsite the team asked for most.

**Decision:** Where should we hold the team offsite?

- **1.** Lisbon (recommended)
- **2.** Mountain cabin
- **3.** Do nothing: no offsite this year

| Option | Cost | Travel | Fun |
|---|---|---|---|
| 1. Lisbon | ~ $1,400 a person | - 9h door to door | ++ top pick in the team survey |
| 2. Cabin | + $600 a person | + 3h drive | + hiking, small group |
| 3. Do nothing | + $0 | + none | - no time together for a year |

- **Cost:** what the company pays per person, all in.
- **Travel:** door-to-door time for most of the team.
- **Fun:** how much people will look forward to it.
```

On web, iOS and Mac this draws as:
- the recommendation as an ordinary sentence;
- three cards numbered 1 to 3, with Lisbon badged as recommended;
- a grid whose rows are numbered 1 to 3 and whose criteria are lettered A to C, each cell on its
  colour;
- a colour key, then the criteria key as an ordinary list.

## A Decision

A paragraph that starts with bold `**Decision:**`, then a list straight after it. Every item starts
with a bold number (or a single letter), and there are at least two items.

```markdown
**Decision:** Ship the fix today or wait for the review?

- **1.** Ship today (recommended)
- **2.** Wait for the review
```

- **Numbered in order:** the cards always show 1, 2, 3 in list order, whatever marker you wrote.
  Write numbers; letters still work for older questions.
- **Marker forms:** `**1.**`, `**1)**`, `**1:**` or plain `**1**` (up to two digits), or the same
  with a letter (`**A.**`), under `-`, `*`, `+` or `1.` bullets.
- **Recommended:** `(recommended)` at the end of an option becomes a badge. Recommend exactly one.
- **Tapping a card** posts `1 — Ship today` as an ordinary comment. That reply is the answer, and if
  the question ended with an `AGENT-HANDBACK:` line it wakes the agent. A link inside an option opens
  the link and does not answer.
- **When cards are inert:** on your own question, in a task description, and once someone else has
  replied after it. A reply that starts with an option's number, or with the letter the asker
  wrote, marks that card as chosen (`2`, `2 — Wait`, `b`). `2nd thoughts` or `10 minutes` do not.

## A trade-off grid

A table where every non-empty cell after the first column starts with a rating, then a space, then
a short reason.

| Token | Meaning | Colour |
|---|---|---|
| `--` | Disqualifying: this alone rules the option out | dark red, white text |
| `-` | Poor: a real cost, survivable | light red |
| `~` | Mixed: acceptable with caveats, conditional, or unknown | yellow |
| `+` | Good: clears the bar | light green |
| `++` | Decisive: this alone is a reason to choose the option | dark green, white text |
| 🔴 / 🟡 / 🟢 | Poor / Mixed / Good | as above |

The exact colours are the design tokens' `palette.tradeoff`
([specs/DESIGN_SYSTEM.md](./specs/DESIGN_SYSTEM.md) → Markdown), so they are the same on every client.

- **Rows:** one per option, numbered to match the Decision (`1. Lisbon`). The grid numbers its rows
  1, 2, 3 itself and drops the marker you wrote (`A. Lisbon`, `2) Cabin` or a lone `B`).
- **Columns:** three to five criteria. The grid letters them A, B, C (then AA after Z), shown before
  each column's name, so a reply can say "1 is weak on B".
- **A key** under the grid names each colour by its rating. Each cell also tells screen readers its
  rating in words ("Good. $600 a person").
- **Even rows and columns:** every option row is as tall as the tallest, and the criteria columns
  share the width equally, never narrower than their longest word. The option column can be
  wider, up to about 12rem, and wraps past that.
- **Wide grids scroll sideways** rather than squeezing columns below about 84px. Rated cells are
  centred; column and option names are centred vertically. Every grid has a **Full screen** control that opens it on its
  own. Dragging a grid that scrolls moves the grid; it never closes the task behind it.
- **Not a grid:** a table with any unrated cell, or one where every cell is a bare `-` (a
  placeholder table). These stay ordinary tables.

## The method

What makes a grid worth reading (ADEV-178, from the Extreme Clarity training):

1. **Name the criteria before judging the options.** Three to five, lettered A, B, C. Beyond five
   they overlap and the grid stops fitting one screen.
2. **List every option, including `Do nothing`.** The status quo gets an honest row of its own. A
   choice that never names it is not a comparison.
3. **Every cell is concrete:** a number, a duration, a count (`+ $600 a person`, `- 9h door to
   door`), never "slightly positive" or "short". Whoever knows a criterion best fills its column.
4. **The bright ratings are a high bar.** `++` Decisive and `--` Disqualifying are for a cell that
   carries the decision on its own. Most cells are `+`, `~` or `-`. A row with a `--` is normally
   out, and the recommendation should say so.
5. **Unknown is `~`, said as unknown** (`~ no quote yet`), never a guess dressed as a rating.
6. **The recommendation comes first,** in one sentence that names the option number and the
   trade-off accepted: *We recommend Lisbon (#1), accepting a 9-hour travel day for the offsite the
   team asked for most.*
7. **The grid does not decide.** Never add a score, weight or total column, and never rank by
   counting colours. A choice against the colours is fine when it is said out loud, pointing at the
   cell being accepted ("we take #3 knowing it is red on B").
8. **When the project states goals, use them.** Its goals make good criteria, and an option that
   breaks a guardrail is `--` on that column ([API_CONTRACT.md](./API_CONTRACT.md) →
   `/api/v1/projects/{id}/goals`, MCP `get_project_goals`).

**Gathering evidence (ADEV-181).** An agent asked to research a decision calls MCP
`gather_decision_evidence { taskId }`. It answers a plain-text brief built from the task's grid
(`lib/decision-evidence.ts`): the criteria and options, the cells with nothing known yet, the
project's goals and guardrails, and the rules above. The agent proposes missing options (keeping
Do nothing), fills each cell with a concrete, sourced assessment, leaves a cell it cannot support
as `~ unknown`, and ends with a Decision for the owner. It proposes; it does not decide, unless the
board's orchestration policy lets it take its own recommendation.

## Explaining the criteria

Put a bold-term list under the grid, one line per column:

```markdown
- **Cost:** what the company pays, all in.
- **Travel:** door-to-door time for most of the team.
```

## Writing one well (for agents)

- **Any question to a person with two to five discrete answers is a Decision.** Open questions stay
  prose.
- **Recommend exactly one option,** and say why in a sentence before the Decision: the option
  number and the trade-off accepted.
- **Keep option text short.** It is posted back verbatim as the reply.
- **Add a grid when the options trade off against several criteria.** Options as rows, numbered to
  match, with a `Do nothing` row; three to five criteria as columns. Follow *The method* above:
  `++` and `--` are a high bar, and never add a score column.
- **Every cell is a rating plus a concrete reason of a few words** (`- 2 days of work`), never a bare
  colour.
- **Define each criterion** in a key list under the grid.
- **End a handback with the `AGENT-HANDBACK: <mailbox>` line** as the last line, as
  [FIXALL_WORKFLOW.md](./FIXALL_WORKFLOW.md) describes. A handback goes to the **Inbox**,
  assigned to the person who must decide — not Waiting, which holds only tasks waiting on a
  date or another task.
- **To show the format as an example,** put it in a fenced code block. A Decision inside a code block
  stays code.

## Where it isn't drawn

Email notifications and any plain-text reader show the markdown as written. The format is chosen to read well that way: a bold question, a numbered list, and a
table with `++` / `-` marks beside short reasons. Nothing is lost; the reader answers by typing the
number.
