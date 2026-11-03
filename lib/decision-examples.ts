/**
 * The canonical Decision + trade-off grid example (AWTD-1531).
 *
 * One example, used everywhere the format is taught: docs/DECISIONS.md quotes it verbatim, the
 * help page renders it, and contracts/fixtures/decisions.json records how web reads it, so the web,
 * iOS and Mac recognisers are tested against the same text. A test fails if the guide drifts.
 */
export const DECISION_EXAMPLE = `**Decision:** Where should we hold the team offsite?

- **1.** Lisbon (recommended)
- **2.** Mountain cabin
- **3.** Stay home and order pizza

| Option | Cost | Travel | Fun |
|---|---|---|---|
| 1. Lisbon | ~ flights for everyone | - a long day | ++ food, sun, city |
| 2. Cabin | + one rental | + 3h drive | + hiking |
| 3. Pizza | ++ cheap | ++ none | -- same as every day |

- **Cost:** what the company pays, all in.
- **Travel:** door-to-door time for most of the team.
- **Fun:** how much people will look forward to it.`

/** The example's Decision alone, for places that show the two formats separately. */
export const DECISION_ONLY_EXAMPLE = DECISION_EXAMPLE.split('\n\n| Option')[0]

/** The example's grid and its criteria key, without the Decision. */
export const TRADEOFF_GRID_EXAMPLE = DECISION_EXAMPLE.slice(DECISION_EXAMPLE.indexOf('| Option'))
