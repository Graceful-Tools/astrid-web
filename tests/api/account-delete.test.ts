import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/v1/users/me/delete/route"
import { authenticateAPI, UnauthorizedError } from "@/lib/api-auth-middleware"
import { prisma } from "@/lib/prisma"
import { del } from "@vercel/blob"

vi.mock("@/lib/api-auth-middleware", () => {
  class UnauthorizedError extends Error {
    constructor(msg = "Unauthorized") { super(msg); this.name = "UnauthorizedError" }
  }
  class ForbiddenError extends Error {
    constructor(msg = "Forbidden") { super(msg); this.name = "ForbiddenError" }
  }
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      delete: vi.fn()
    },
    session: {
      findUnique: vi.fn()
    }
  }
}))
vi.mock("@vercel/blob", () => ({
  del: vi.fn()
}))

describe("Account Delete API", () => {
  const mockSession = {
    userId: "user-123",
    source: "session" as const,
    scopes: ["*"],
    isAIAgent: false,
    user: { id: "user-123", email: "test@example.com", name: null, isAIAgent: false }
  }

  const mockOAuthUser = {
    id: "user-123",
    email: "test@example.com",
    secureFiles: [],
    accounts: [
      { id: "account-1", provider: "google", providerAccountId: "12345" }
    ],
    authenticators: []
  }

  const mockPasskeyUser = {
    id: "user-123",
    email: "test@example.com",
    secureFiles: [],
    accounts: [],
    authenticators: [
      { id: "passkey-1", credentialDeviceType: "singleDevice", credentialBackedUp: false }
    ]
  }

  const mockUserWithFiles = {
    ...mockOAuthUser,
    secureFiles: [
      { id: "file-1", blobUrl: "https://blob.vercel-storage.com/file1" },
      { id: "file-2", blobUrl: "https://blob.vercel-storage.com/file2" }
    ]
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("Authentication", () => {
    it("should require authentication", async () => {
      vi.mocked(authenticateAPI).mockRejectedValue(new UnauthorizedError())

      const request = new NextRequest("http://localhost:3000/api/v1/users/me/delete", {
        method: "POST",
        body: JSON.stringify({
          confirmationText: "DELETE MY ACCOUNT"
        })
      })

      const response = await POST(request)

      expect(response.status).toBe(401)
      expect((await response.json()).error).toBe("Unauthorized")
    })
  })

  describe("Confirmation Validation", () => {
    it("should reject invalid confirmation text", async () => {
      vi.mocked(authenticateAPI).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOAuthUser as any)

      const request = new NextRequest("http://localhost:3000/api/v1/users/me/delete", {
        method: "POST",
        body: JSON.stringify({
          confirmationText: "delete my account"
        })
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
      const error = await response.json()
      expect(error.error).toContain("Invalid confirmation text")
    })

    it("should accept exact confirmation text for OAuth users", async () => {
      vi.mocked(authenticateAPI).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOAuthUser as any)
      vi.mocked(prisma.user.delete).mockResolvedValue({} as any)

      const request = new NextRequest("http://localhost:3000/api/v1/users/me/delete", {
        method: "POST",
        body: JSON.stringify({
          confirmationText: "DELETE MY ACCOUNT"
        })
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
    })
  })

  describe("Auth method requirement", () => {
    it("should allow deletion for OAuth users", async () => {
      vi.mocked(authenticateAPI).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOAuthUser as any)
      vi.mocked(prisma.user.delete).mockResolvedValue({} as any)

      const request = new NextRequest("http://localhost:3000/api/v1/users/me/delete", {
        method: "POST",
        body: JSON.stringify({
          confirmationText: "DELETE MY ACCOUNT"
        })
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
    })

    it("should allow deletion for passkey-only users", async () => {
      vi.mocked(authenticateAPI).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockPasskeyUser as any)
      vi.mocked(prisma.user.delete).mockResolvedValue({} as any)

      const request = new NextRequest("http://localhost:3000/api/v1/users/me/delete", {
        method: "POST",
        body: JSON.stringify({
          confirmationText: "DELETE MY ACCOUNT"
        })
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
    })

    it("should reject users with no auth method", async () => {
      vi.mocked(authenticateAPI).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockOAuthUser,
        accounts: [],
        authenticators: []
      } as any)

      const request = new NextRequest("http://localhost:3000/api/v1/users/me/delete", {
        method: "POST",
        body: JSON.stringify({
          confirmationText: "DELETE MY ACCOUNT"
        })
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
      const error = await response.json()
      expect(error.error).toContain("authentication method")
    })
  })

  describe("File Cleanup", () => {
    it("should delete user files from blob storage", async () => {
      vi.mocked(authenticateAPI).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUserWithFiles as any)
      vi.mocked(prisma.user.delete).mockResolvedValue({} as any)
      vi.mocked(del).mockResolvedValue(undefined as never)

      const request = new NextRequest("http://localhost:3000/api/v1/users/me/delete", {
        method: "POST",
        body: JSON.stringify({
          confirmationText: "DELETE MY ACCOUNT"
        })
      })

      await POST(request)

      expect(del).toHaveBeenCalledTimes(2)
      expect(del).toHaveBeenCalledWith("https://blob.vercel-storage.com/file1")
      expect(del).toHaveBeenCalledWith("https://blob.vercel-storage.com/file2")
    })

    it("should continue deletion even if file cleanup fails", async () => {
      vi.mocked(authenticateAPI).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUserWithFiles as any)
      vi.mocked(del).mockRejectedValue(new Error("File deletion failed") as never)
      vi.mocked(prisma.user.delete).mockResolvedValue({} as any)

      const request = new NextRequest("http://localhost:3000/api/v1/users/me/delete", {
        method: "POST",
        body: JSON.stringify({
          confirmationText: "DELETE MY ACCOUNT"
        })
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(prisma.user.delete).toHaveBeenCalled()
    })
  })

  describe("Account Deletion", () => {
    it("should delete user from database", async () => {
      vi.mocked(authenticateAPI).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOAuthUser as any)
      vi.mocked(prisma.user.delete).mockResolvedValue({} as any)

      const request = new NextRequest("http://localhost:3000/api/v1/users/me/delete", {
        method: "POST",
        body: JSON.stringify({
          confirmationText: "DELETE MY ACCOUNT"
        })
      })

      await POST(request)

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: "user-123" }
      })
    })
  })

  describe("Error Handling", () => {
    it("should handle database errors", async () => {
      vi.mocked(authenticateAPI).mockResolvedValue(mockSession as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOAuthUser as any)
      vi.mocked(prisma.user.delete).mockRejectedValue(new Error("Database error"))

      const request = new NextRequest("http://localhost:3000/api/v1/users/me/delete", {
        method: "POST",
        body: JSON.stringify({
          confirmationText: "DELETE MY ACCOUNT"
        })
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      const error = await response.json()
      expect(error.error).toContain("Failed to delete account")
    })
  })
})
