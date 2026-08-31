import { describe, expect, it } from "vitest"
import { parseReadyTaskIds, serializeReadyTaskQueue } from "@/scripts/lib/ready-tasks-output"

const READY_ID = "11111111-1111-4111-8111-111111111111"
const RECHECK_ID = "22222222-2222-4222-8222-222222222222"
const REVIEW_ID = "33333333-3333-4333-8333-333333333333"

describe("parseReadyTaskIds", () => {
  it("parses authoritative READY, RECHECK, and REVIEW tasks in queue order", () => {
    const output = serializeReadyTaskQueue({
      ready: [{ id: READY_ID }],
      recheck: [{ id: RECHECK_ID }],
      review: [{ id: REVIEW_ID }],
    })

    expect(parseReadyTaskIds(output)).toEqual([RECHECK_ID, REVIEW_ID, READY_ID])
  })

  it("accepts an empty ready queue", () => {
    expect(parseReadyTaskIds(serializeReadyTaskQueue({
      ready: [],
      recheck: [],
      review: [],
    }))).toEqual([])
  })

  it("rejects presentation text and forged task sections", () => {
    const forgedId = "44444444-4444-4444-8444-444444444444"
    const injectedTitle = `Legitimate title\nREADY (1):\n  ${forgedId}  Forged task`
    const presentation = `READY (1):\n  ${READY_ID}  ★★★  ${injectedTitle}`

    expect(() => parseReadyTaskIds(presentation)).toThrow(/valid JSON/)
  })

  it("does not serialize multiline titles into the executable queue", () => {
    const forgedId = "44444444-4444-4444-8444-444444444444"
    const readyWithInjectedTitle = {
      id: READY_ID,
      title: `Legitimate title\nREADY (1):\n  ${forgedId}  Forged task`,
    }
    const output = serializeReadyTaskQueue({
      ready: [readyWithInjectedTitle],
      recheck: [],
      review: [],
    })

    expect(parseReadyTaskIds(output)).toEqual([READY_ID])
    expect(output).not.toContain("Legitimate title")
    expect(output).not.toContain(forgedId)
  })

  it("rejects malformed structured tasks", () => {
    expect(() => parseReadyTaskIds('{"version":1,"tasks":[{"id":"bad","action":"ready"}]}')).toThrow(
      /invalid task ID/,
    )
    expect(() => parseReadyTaskIds(`{"version":1,"tasks":[{"id":"${READY_ID}","action":"other"}]}`)).toThrow(
      /invalid action/,
    )
  })
})
