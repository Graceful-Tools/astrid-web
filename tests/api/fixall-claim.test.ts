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
    task: { updateMany: vi.fn(), findUnique: vi.fn() },
    comment: { create: vi.fn() },
    $transaction: vi.fn(),
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
    vi.mocked(prisma.$transaction).mockImplementation(async work => {
      if (typeof work !== 'function') throw new Error('Expected an interactive transaction')
      return work(prisma)
    })
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

  it('AWTD-1383: recovery cannot park a task after its owner, version or comments changed', async () => {
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 0 })
    const version = '2026-10-25T10:00:00Z'
    const listId = 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba'
    const response = await POST(request({
      action: 'pause', agent: 'copilot', listId, taskVersion: version, commentWatermark: version,
    }), { params })
    expect(response.status).toBe(409)
    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: TASK_ID, completed: false, assigneeId: 'copilot-1', statusRole: 'doing',
        updatedAt: new Date(version), lists: { some: { id: { in: [listId] } } },
        comments: { none: { updatedAt: { gt: new Date(version) } } },
      },
      data: { assigneeId: 'copilot-1', statusRole: 'waiting' },
    })
  })

  it('AWTD-1383: commits native ownership with the claim, never after a lost race', async () => {
    const body = { action: 'ready', agent: 'copilot', listId: 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba',
      nativeDispatch: { repository: 'Graceful-Tools/astrid-web', issueNumber: 17 } }
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 1 })
    expect((await POST(request(body), { params })).status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.comment.create).toHaveBeenCalledWith({ data: {
      taskId: TASK_ID, authorId: 'copilot-1',
      content: `NATIVE-COPILOT-CLAIM: ${JSON.stringify({ listId: body.listId, taskId: TASK_ID, ...body.nativeDispatch })}`,
    } })
    vi.mocked(prisma.comment.create).mockClear()
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 0 })
    expect((await POST(request(body), { params })).status).toBe(409)
    expect(prisma.comment.create).not.toHaveBeenCalled()
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

  it('atomically resumes only the exact human reply to an agent-owned handback', async () => {
      const createdAt = new Date('2026-10-25T10:00:00Z')
      const updatedAt = new Date('2026-10-25T11:00:00Z')
      const resume = {
        listId: 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba', assigneeId: 'human',
        handbackCommentId: 'question', replyCommentId: 'reply', commentWatermark: updatedAt.toISOString(),
      }
      const row = {
        completed: false, statusRole: 'waiting', assigneeId: 'human', updatedAt,
        assignee: { isAIAgent: false }, lists: [{ id: resume.listId }],
        comments: [
          { id: 'reply', authorId: 'human', author: { isAIAgent: false },
            content: 'Use existing behaviour', createdAt: updatedAt, updatedAt },
          { id: 'question', authorId: 'copilot-1', author: { isAIAgent: true },
            content: 'Which behaviour?\nAGENT-HANDBACK: copilot', createdAt, updatedAt: createdAt },
        ],
      }
      vi.mocked(prisma.task.findUnique).mockResolvedValue(row as never)
      vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 1 })
      const body = { action: 'resume', agent: 'copilot', resume, commentWatermark: resume.commentWatermark }
      expect((await POST(request(body), { params })).status).toBe(200)
      expect(prisma.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { assigneeId: 'copilot-1', statusRole: 'doing' },
        where: expect.objectContaining({
          statusRole: 'waiting', assigneeId: 'human', updatedAt,
          lists: { some: { id: resume.listId } },
          AND: expect.arrayContaining([{ comments: { none: { updatedAt: { gt: updatedAt } } } }]),
        }),
      }))
      vi.mocked(prisma.task.updateMany).mockClear()
      expect((await POST(request({ ...body, resume: { ...resume, replyCommentId: 'stale' } }), { params })).status).toBe(409)
      expect(prisma.task.updateMany).not.toHaveBeenCalled()
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        ...row, comments: [row.comments[0], { ...row.comments[1], authorId: 'spoof' }],
      } as never)
      expect((await POST(request(body), { params })).status).toBe(409)
      expect(prisma.task.updateMany).not.toHaveBeenCalled()
  })
})
