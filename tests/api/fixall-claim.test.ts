import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/api-auth-middleware", () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    requireTaskAccess: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    task: { updateMany: vi.fn() },
  },
}))

import { POST } from "@/app/api/v1/tasks/[id]/claim-fixall/route"
import { authenticateAPI, requireTaskAccess } from "@/lib/api-auth-middleware"
import { prisma } from "@/lib/prisma"
import { BRAND } from '@/lib/brand/config'

const TASK_ID = "11111111-1111-4111-8111-111111111111"
const params = Promise.resolve({ id: TASK_ID })

function request(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/tasks/${TASK_ID}/claim-fixall`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/v1/tasks/:id/claim-fixall", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAPI).mockResolvedValue({
      userId: "owner-1",
      source: "oauth",
      scopes: ["tasks:write"],
    } as never)
    vi.mocked(requireTaskAccess).mockResolvedValue(undefined)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "copilot-1",
      email: `copilot@${BRAND.agentEmailDomain}`,
      isAIAgent: true,
      isActive: true,
    } as never)
  })

  it("claims through one conditional update when the queue state still matches", async () => {
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 1 })

    const response = await POST(request({
      action: "ready",
      commentWatermark: null,
    }), { params })

    expect(response.status).toBe(200)
    expect(prisma.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      // Ready in the where, Doing in the data: that pairing is what makes the
      // claim exclusive, so a second concurrent claim matches nothing.
      data: { assigneeId: "copilot-1", statusRole: "doing" },
      where: expect.objectContaining({
        id: TASK_ID,
        completed: false,
        OR: [{ assigneeId: null }, { assigneeId: "copilot-1" }],
        statusRole: "ready",
      }),
    }))
  })

  it("claims for the harness that asked, not always for Copilot", async () => {
    // A Claude Code loop claiming as Copilot would assign its own work to a
    // different harness. Before this the identity was a module constant, which
    // is why the local loops could not use this endpoint at all.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "claude-1",
      email: `claude@${BRAND.agentEmailDomain}`,
      isAIAgent: true,
      isActive: true,
    } as never)
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 1 })

    const response = await POST(request({ action: "ready", agent: "claude" }), { params })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      claimed: true,
      agent: "claude",
      assigneeEmail: `claude@${BRAND.agentEmailDomain}`,
    })
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: `claude@${BRAND.agentEmailDomain}` } }),
    )
    expect(prisma.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { assigneeId: "claude-1", statusRole: "doing" },
    }))
  })

  it("rejects a mailbox that is not a fixall harness", async () => {
    const response = await POST(request({ action: "ready", agent: "jonparis" }), { params })

    expect(response.status).toBe(400)
    expect(prisma.task.updateMany).not.toHaveBeenCalled()
  })

  it("returns conflict instead of overwriting a task changed after queue selection", async () => {
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 0 })

    const response = await POST(request({
      action: "recheck",
      commentWatermark: "2026-08-30T20:00:00.000Z",
    }), { params })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "Task changed after queue selection and was not claimed",
    })
  })
})
