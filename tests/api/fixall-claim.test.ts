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
      email: "copilot@astrid.cc",
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
      data: { assigneeId: "copilot-1" },
      where: expect.objectContaining({
        id: TASK_ID,
        completed: false,
        OR: [{ assigneeId: null }, { assigneeId: "copilot-1" }],
        statusRole: "ready",
      }),
    }))
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
