// Splits a driver's cases into the ones every client agrees on and the ones they do not.
//
// The follow-iOS rule (docs/CONTRACTS.md, top; Jon 2026-10-03) means the core deliberately
// answers some cases as iOS does while web still answers differently. A web-generated fixture
// cannot hold those as expectations — the core would fail them on purpose — and leaving them out
// silently would make the divergence invisible. So they are written to the fixture's `disputed`
// array instead, each carrying web's answer and the CONTRACTS.md entry that explains it.
//
// The Rust test runs every case in `cases` and requires equality. For `disputed` it requires the
// opposite at the level of the entry: at least one of each entry's cases must still disagree with
// web. When web moves to iOS's behaviour every case of the entry starts agreeing, the test fails,
// and the exclusion is removed here — an exclusion cannot outlive its reason.
//
// A dispute is declared as a predicate over the case's INPUTS, never over web's answer: the
// driver says "this kind of case is D33's", not "this case is excluded because web said X".

/**
 * @param {Array<object>} cases every case, each with a unique `id`, already answered by web
 * @param {Array<{entry: string, why: string, applies: (c: object) => boolean}>} disputes
 * @returns {{cases: object[], disputed: object[]}}
 */
export function partition(cases, disputes) {
  const ids = new Set()
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`)
    ids.add(c.id)
  }
  const agreed = []
  const disputed = []
  const used = new Set()
  for (const c of cases) {
    const d = disputes.find((dispute) => dispute.applies(c))
    if (d) {
      used.add(d.entry)
      disputed.push({ entry: d.entry, ...c })
    } else {
      agreed.push(c)
    }
  }
  for (const d of disputes) {
    if (!used.has(d.entry)) throw new Error(`dispute ${d.entry} matches no case — remove it or add a case`)
  }
  return {
    cases: agreed,
    disputed,
    disputes: disputes.map(({ entry, why }) => ({ entry, why })),
  }
}
