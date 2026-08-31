import { describe, expect, it } from "vitest"
import {
  FIXALL_CLAIM_BOARD_IDS,
  buildAtomicFixallClaimWhere,
  parseFixallClaimRequest,
} from "@/lib/fixall-claim"

describe("buildAtomicFixallClaimWhere", () => {
  const now = new Date("2026-08-30T20:00:00.000Z")
  const webBoardId = "a623f322-4c3c-49b5-8a94-d2d9f00c82ba"
  const iosBoardId = "aa41c1a3-bd63-4c6d-9b87-42c6e0aafa36"

  it("allows the web and iOS boards while preserving the other atomic guards", () => {
    expect(buildAtomicFixallClaimWhere({
      taskId: "task-1",
      agentId: "copilot-1",
      claim: { action: "ready", commentWatermark: null },
      now,
    })).toEqual(expect.objectContaining({
      id: "task-1",
      completed: false,
      lists: { some: { id: { in: [webBoardId, iosBoardId] } } },
      OR: [{ assigneeId: null }, { assigneeId: "copilot-1" }],
      statusRole: "ready",
      AND: [{ OR: [{ dueDateTime: null }, { dueDateTime: { lte: now } }] }],
    }))

    expect(FIXALL_CLAIM_BOARD_IDS).toEqual([webBoardId, iosBoardId])
  })

  it("does not allow atomic claims from an arbitrary board", () => {
    const where = buildAtomicFixallClaimWhere({
      taskId: "task-1",
      agentId: "copilot-1",
      claim: { action: "ready", commentWatermark: null },
      now,
    })

    expect(where.lists.some.id.in).not.toContain("different-board")
  })

  it("rejects a waiting claim if comments changed after classification", () => {
    const watermark = "2026-08-30T19:00:00.000Z"
    expect(buildAtomicFixallClaimWhere({
      taskId: "task-1",
      agentId: "copilot-1",
      claim: { action: "recheck", commentWatermark: watermark },
      now,
    })).toEqual(expect.objectContaining({
      statusRole: "waiting",
      AND: [{ OR: [{ dueDateTime: null }, { dueDateTime: { lte: now } }] }],
      comments: { none: { updatedAt: { gt: new Date(watermark) } } },
    }))
  })

  it("keeps null-dated external rechecks eligible like the queue classifier", () => {
    const where = buildAtomicFixallClaimWhere({
      taskId: "task-1",
      agentId: "copilot-1",
      claim: { action: "recheck", commentWatermark: null },
      now,
    })

    expect(where).toEqual(expect.objectContaining({
      AND: [{ OR: [{ dueDateTime: null }, { dueDateTime: { lte: now } }] }],
    }))
  })
})

describe("parseFixallClaimRequest", () => {
  it("requires a watermark for waiting actions and none for ready", () => {
    expect(parseFixallClaimRequest({ action: "ready" })).toEqual({
      action: "ready",
      commentWatermark: null,
    })
    expect(() => parseFixallClaimRequest({ action: "ready", commentWatermark: "2026-08-30T00:00:00Z" }))
      .toThrow(/must not include/)
    expect(() => parseFixallClaimRequest({ action: "recheck" })).toThrow(/watermark/)
  })
})
