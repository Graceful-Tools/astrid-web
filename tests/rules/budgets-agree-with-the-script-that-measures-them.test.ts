/**
 * RULES TEST — AWTD-1238.
 *
 * `scripts/measure-api-latency.ts` says of its constants: *"Budgets from
 * docs/PERFORMANCE_BUDGETS.md, so drift shows up as a failure."* Nothing made
 * that true. The numbers live in two files and a reader checking either one
 * has no way to know it is reading the stale copy.
 *
 * It matters most for the pair AWTD-1238 introduced, because they are easy to
 * confuse: a per-task REGRESSION gate and a per-page SIZE cap. Raising one in
 * the document while the script still judges the other is how a breach gets
 * reported as a pass.
 *
 * This asserts the two files carry the same numbers. It does not assert what
 * the numbers should be — that is a judgement, and it belongs in the document
 * where the reasoning is.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPT = readFileSync(join(process.cwd(), 'scripts/measure-api-latency.ts'), 'utf8')
const DOC = readFileSync(join(process.cwd(), 'docs/PERFORMANCE_BUDGETS.md'), 'utf8')

describe('the budget document and the script that measures it agree', () => {
  it('uses the same per-task regression budget', () => {
    const inScript = SCRIPT.match(/perTaskBudgetBytes:\s*(\d+)/)
    const inDoc = DOC.match(/<=\s*(\d+)\s*bytes\/task/)

    expect(inScript?.[1], 'scripts/measure-api-latency.ts must declare perTaskBudgetBytes').toBeDefined()
    expect(inDoc?.[1], 'docs/PERFORMANCE_BUDGETS.md must state the per-task budget').toBeDefined()
    expect(
      inScript?.[1],
      'the per-task regression budget differs between the script and the document',
    ).toBe(inDoc?.[1])
  })

  it('uses the same page cap for the task read', () => {
    // 500 KiB, the client-experience cap. It is deliberately left breached
    // rather than raised, so the two copies agreeing is what keeps the breach
    // legible instead of looking like a stale document.
    const inScript = SCRIPT.match(/budgetKiB:\s*(\d+)/)
    const inDoc = DOC.match(/<=\s*(\d+)\s*KiB\s*\*\*on the wire\*\*/)

    expect(inScript?.[1]).toBe(inDoc?.[1])
  })

  it('keeps the regression gate measured on the lean read', () => {
    // Per-task bytes alone still drifts upward as descriptions get longer. The
    // `omit=description` in that route's path is what makes the number depend
    // on the code rather than on how much anyone wrote, so it is not an
    // incidental query parameter.
    const leanRoute = SCRIPT.match(/path:\s*'([^']*omit=description[^']*)'[^}]*perTaskBudgetBytes/s)

    expect(
      leanRoute,
      'the per-task budget must be measured against a path carrying omit=description',
    ).not.toBeNull()
  })
})
