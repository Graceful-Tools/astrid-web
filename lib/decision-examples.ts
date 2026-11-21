/**
 * The canonical Decision + trade-off grid example (AWTD-1531), written to the Extreme Clarity
 * method (ADEV-178): the recommendation first, a do-nothing option, and the two bright ratings
 * used only where one cell alone carries the decision.
 *
 * One example, used everywhere the format is taught: docs/DECISIONS.md quotes it verbatim, the
 * help page renders it, and contracts/fixtures/decisions.json records how web reads it, so the web,
 * iOS and Mac recognisers are tested against the same text. A test fails if the guide drifts.
 */
export const DECISION_EXAMPLE = `We recommend Lisbon (#1), accepting a 9-hour travel day for the offsite the team asked for most.

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
- **Fun:** how much people will look forward to it.`

/** The example's Decision alone, for places that show the two formats separately. */
export const DECISION_ONLY_EXAMPLE = DECISION_EXAMPLE.slice(DECISION_EXAMPLE.indexOf('**Decision:**')).split('\n\n| Option')[0]

/** The example's grid and its criteria key, without the Decision. */
export const TRADEOFF_GRID_EXAMPLE = DECISION_EXAMPLE.slice(DECISION_EXAMPLE.indexOf('| Option'))
