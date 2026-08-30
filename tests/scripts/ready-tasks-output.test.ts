import { describe, expect, it } from "vitest"
import { parseReadyTaskIds } from "@/scripts/lib/ready-tasks-output"

const READY_ID = "11111111-1111-4111-8111-111111111111"
const RECHECK_ID = "22222222-2222-4222-8222-222222222222"
const REVIEW_ID = "33333333-3333-4333-8333-333333333333"

describe("parseReadyTaskIds", () => {
  it("parses READY, RECHECK, and REVIEW tasks in queue order", () => {
    const output = [
      "RECHECK (1) — re-verify each condition; if met move to Ready, if not bump the recheck date:",
      `  ${RECHECK_ID}  Upgrade dependency  [waiting on: upstream release]`,
      "REVIEW (1) — Waiting with NO recorded condition; give each a date:",
      `  ${REVIEW_ID}  Clarify blocked work`,
      "READY (1):",
      `  ${READY_ID}  ★★★  Fix the workflow`,
    ].join("\n")

    expect(parseReadyTaskIds(output)).toEqual([RECHECK_ID, REVIEW_ID, READY_ID])
  })

  it("accepts an empty ready queue", () => {
    expect(parseReadyTaskIds("Some informational output\nREADY_EMPTY\n")).toEqual([])
  })

  it("keeps RECHECK and REVIEW actionable when READY is empty", () => {
    const output = [
      "RECHECK (1) — re-verify each condition:",
      `  ${RECHECK_ID}  Upgrade dependency  [waiting on: upstream release]`,
      "REVIEW (1) — Waiting with NO recorded condition:",
      `  ${REVIEW_ID}  Clarify blocked work`,
      "READY_EMPTY (but RECHECK/REVIEW above need the agent)",
    ].join("\n")

    expect(parseReadyTaskIds(output)).toEqual([RECHECK_ID, REVIEW_ID])
  })

  it("rejects malformed or incomplete output instead of silently returning empty", () => {
    expect(() => parseReadyTaskIds("OAuth request failed")).toThrow(/READY/)
    expect(() => parseReadyTaskIds("READY (2):\n  malformed  Task")).toThrow(
      /declared 2 actionable task\(s\), but parsed 0/,
    )
  })
})
