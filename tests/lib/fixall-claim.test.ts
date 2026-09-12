import { describe, expect, it } from "vitest"
import {
  FIXALL_CLAIM_AGENT_EMAIL,
  FIXALL_CLAIM_BOARD_IDS,
  buildAtomicFixallClaimWhere,
  buildFixallClaimData,
  fixallClaimAgentEmail,
  parseFixallClaimRequest,
} from "@/lib/fixall-claim"
import { BRAND } from "@/lib/brand/config"

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
      // Unstated agent means Copilot — see the harness block below.
      agent: "copilot",
    })
    expect(() => parseFixallClaimRequest({ action: "ready", commentWatermark: "2026-08-30T00:00:00Z" }))
      .toThrow(/must not include/)
    expect(() => parseFixallClaimRequest({ action: "recheck" })).toThrow(/watermark/)
  })
})

/**
 * RED for the /fixall collision fix — the claim was neither EXCLUSIVE nor
 * harness-aware.
 *
 * Exclusivity: the where matched `assigneeId: null OR assigneeId: agentId` and
 * the update wrote only `assigneeId`. Two workers running as the same agent
 * therefore BOTH matched — the first because the task was unassigned, the second
 * because it was now assigned to itself — and both were told `CLAIMED`. Nothing
 * detected it in CI only because .github/workflows/fixall.yml carries a
 * `concurrency:` group; local harness loops have no such guard, and on
 * 2026-09-09 two Claude Code sessions worked AWTD-865 simultaneously.
 *
 * Harness-awareness: the claimed identity was hardcoded to Copilot, so a Claude
 * Code loop could not claim for itself at all — claiming would have reassigned
 * the task to Copilot and handed its own work to another harness.
 */
describe("the claim is exclusive (AWTD-865 follow-up)", () => {
  const now = new Date("2026-09-09T06:00:00.000Z")

  it("moves a ready task OUT of the status its own where clause requires", () => {
    // This is the whole mechanism. The where demands `ready`; the data writes
    // `doing`. One UPDATE ... WHERE either matches or does not, so the second of
    // two concurrent claims re-evaluates against `doing`, matches zero rows, and
    // is reported as a conflict instead of a second success.
    const where = buildAtomicFixallClaimWhere({
      taskId: "task-1",
      agentId: "claude-1",
      claim: { action: "ready", commentWatermark: null, agent: "claude" },
      now,
    })
    const data = buildFixallClaimData({
      agentId: "claude-1",
      claim: { action: "ready", commentWatermark: null, agent: "claude" },
    })

    expect(where.statusRole).toBe("ready")
    expect(data.statusRole).toBe("doing")
    expect(data.statusRole).not.toBe(where.statusRole)
    expect(data.assigneeId).toBe("claude-1")
  })

  it("leaves a waiting task in Waiting — a recheck is not the start of work", () => {
    // RECHECK and REVIEW re-examine a paused task. Flipping those to Doing would
    // empty the Waiting lane on every sweep and lose the condition the lane exists
    // to record.
    const data = buildFixallClaimData({
      agentId: "claude-1",
      claim: { action: "recheck", commentWatermark: null, agent: "claude" },
    })

    expect(data.statusRole).toBeUndefined()
    expect(data.assigneeId).toBe("claude-1")
  })
})

describe("the claim names its harness (AWTD-865 follow-up)", () => {
  it("defaults to Copilot so the GitHub Actions worker keeps working unchanged", () => {
    // .github/workflows/fixall.yml posts no `agent`, and it is deployed
    // independently of this change. Absence must keep meaning what it meant.
    expect(parseFixallClaimRequest({ action: "ready" }).agent).toBe("copilot")
  })

  it("accepts the local harness mailboxes", () => {
    expect(parseFixallClaimRequest({ action: "ready", agent: "claude" }).agent).toBe("claude")
    expect(parseFixallClaimRequest({ action: "ready", agent: "codex" }).agent).toBe("codex")
  })

  it("refuses a mailbox that is not a fixall harness", () => {
    // An ALLOWLIST, like FIXALL_CLAIM_BOARD_IDS above it: a claim decides which
    // account ends up owning the task, so an arbitrary string must not reach the
    // user lookup.
    expect(() => parseFixallClaimRequest({ action: "ready", agent: "jonparis" }))
      .toThrow(/harness/i)
    expect(() => parseFixallClaimRequest({ action: "ready", agent: "" })).toThrow(/harness/i)
  })

  it("builds the agent identity from the brand domain, not a literal", () => {
    expect(fixallClaimAgentEmail("claude")).toBe(`claude@${BRAND.agentEmailDomain}`)
    expect(fixallClaimAgentEmail("copilot")).toBe(FIXALL_CLAIM_AGENT_EMAIL)
  })
})
