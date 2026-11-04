/**
 * Decisions are numbered, grid columns lettered (AWTD-1533, following iOS AITD-585).
 *
 * Option cards show 1, 2, 3 whatever marker the asker wrote, and options may be written **1.** as
 * well as **A.**. Tapping posts "2 — Wait". A reply leading with the number, or with the asker's
 * own letter, marks that card. A grid's rows are numbered and lose their own marker; its criteria
 * columns are lettered A, B, C, then AA after Z.
 */
import { describe, it, expect } from 'vitest'
import { parseDecision, decisionReply, chosenNumber, rowName, columnLetter } from '@/lib/comment-formats'
import { renderMarkdownWithLinks } from '@/lib/markdown'

describe('AWTD-1533 options are numbered', () => {
  it.each([
    '**Decision:** Which way?\n- **A.** Go\n- **B.** Wait\n- **C.** Neither',
    '**Decision:** Which way?\n1. **1.** Go\n2. **2.** Wait\n3. **3.** Neither',
    '**Decision:** Which way?\n- **1)** Go\n- **2)** Wait\n- **3)** Neither',
  ])('numbers the options in order: %s', source => {
    const d = parseDecision(source)!
    expect(d.options.map(o => o.number)).toEqual([1, 2, 3])
    expect(d.options.map(decisionReply)).toEqual(['1 — Go', '2 — Wait', '3 — Neither'])
  })

  it('a three-digit marker is not an option', () => {
    expect(parseDecision('**Decision:** x\n- **100.** a\n- **101.** b')).toBeNull()
  })
})

describe('AWTD-1533 a reply chooses by number or by the asker\'s letter', () => {
  const lettered = parseDecision('**Decision:** x\n- **A.** a\n- **B.** b\n- **C.** c')!.options

  it.each([
    ['A', 1], ['b', 2], ['C — Something else', 3], ['  A. go', 1],
    ['2 — Wait', 2], ['3', 3], ['1. go', 1],
  ] as const)('%s chooses %s', (reply, n) => {
    expect(chosenNumber(reply, lettered)).toBe(n)
  })

  it.each([
    'Also, what about D?', 'D', 'Let me think', '4', '0', '2nd thoughts', '10 minutes', '',
    // Copilot on #669: a non-ASCII letter right after the lead is still part of a word.
    'Béatrice doit vérifier', '2ème avis nécessaire',
  ])(
    '%s chooses nothing',
    reply => expect(chosenNumber(reply, lettered)).toBeNull(),
  )
})

describe('AWTD-1533 grid rows numbered, columns lettered', () => {
  it('drops the row\'s own marker', () => {
    expect(['A. Lisbon', '2) Cabin', 'Pizza', 'B', 'I am here', 'A.Lisbon'].map(rowName))
      .toEqual(['Lisbon', 'Cabin', 'Pizza', '', 'I am here', 'A.Lisbon'])
  })

  it('letters columns like a spreadsheet', () => {
    expect([0, 1, 2, 25, 26, 27, 51, 52].map(columnLetter)).toEqual(['A', 'B', 'C', 'Z', 'AA', 'AB', 'AZ', 'BA'])
  })

  it('keeps a row\'s words when the first one only looks like a marker (Copilot on #669)', () => {
    const html = renderMarkdownWithLinks(
      '| Option | Cost |\n|---|---|\n| I **am** here | + a |\n| **I** am here | + b |\n| A. Visit [Lisbon](https://example.com) | + c |\n| **B** | + d |',
    )
    const firstCells = [...html.matchAll(/<tr[^>]*><td[^>]*>(.*?)<\/td>/g)].map(m => m[1].replace(/<[^>]+>/g, ''))
    expect(firstCells).toEqual(['1. I am here', '2. I am here', '3. Visit Lisbon', '4. '])
  })

  it('draws numbered rows and lettered criteria', () => {
    const html = renderMarkdownWithLinks(
      '| Option | Cost | Travel |\n|---|---|---|\n| A. Lisbon | ~ flights | - long |\n| **2)** Cabin | + rental | + 3h |\n| Pizza | ++ cheap | ++ none |\n| B | + x | + y |',
    )
    const firstCells = [...html.matchAll(/<tr[^>]*><td[^>]*>(.*?)<\/td>/g)].map(m => m[1])
    expect(firstCells).toEqual(['1. Lisbon', '2. Cabin', '3. Pizza', '4. '])
    const heads = [...html.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/g)].map(m => m[1])
    expect(heads).toEqual([
      'Option',
      '<span class="tradeoff-col">A</span> Cost',
      '<span class="tradeoff-col">B</span> Travel',
    ])
  })
})
