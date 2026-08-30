import { describe, expect, it } from "vitest"
import {
  FIXALL_AGENT_EMAIL,
  parseFixallMcpRotationOptions,
  propagateFixallMcpToken,
  runSerializedFixallMcpRotation,
  validateFixallAgent,
} from "@/scripts/lib/fixall-mcp-rotation"

describe("parseFixallMcpRotationOptions", () => {
  it("requires an explicit mode and database environment variable", () => {
    expect(() => parseFixallMcpRotationOptions([])).toThrow(/exactly one/)
    expect(() => parseFixallMcpRotationOptions(["--dry-run"])).toThrow(/database-url-env/)
  })

  it("allows a dry run without production confirmation", () => {
    expect(parseFixallMcpRotationOptions([
      "--dry-run",
      "--database-url-env",
      "DATABASE_URL_DIRECT",
    ])).toEqual({
      mode: "dry-run",
      databaseUrlEnv: "DATABASE_URL_DIRECT",
      productionConfirmed: false,
    })
  })

  it("requires explicit production confirmation before applying", () => {
    expect(() => parseFixallMcpRotationOptions([
      "--apply",
      "--database-url-env",
      "DATABASE_URL_DIRECT",
    ])).toThrow(/--production/)
  })
})

describe("validateFixallAgent", () => {
  it("accepts only the active copilot AI agent", () => {
    expect(() => validateFixallAgent({
      email: FIXALL_AGENT_EMAIL,
      isAIAgent: true,
      isActive: true,
    })).not.toThrow()

    expect(() => validateFixallAgent({
      email: "claude@astrid.cc",
      isAIAgent: true,
      isActive: true,
    })).toThrow(/unexpected agent/)
    expect(() => validateFixallAgent({
      email: FIXALL_AGENT_EMAIL,
      isAIAgent: false,
      isActive: true,
    })).toThrow(/not marked as an AI agent/)
    expect(() => validateFixallAgent(null)).toThrow(/does not exist/)
  })
})

describe("propagateFixallMcpToken", () => {
  it("updates both repositories before deactivating superseded tokens", async () => {
    const events: string[] = []
    const deactivated = await propagateFixallMcpToken(
      "secret-in-memory",
      async (repository, plaintext) => {
        expect(plaintext).toBe("secret-in-memory")
        events.push(`set:${repository}`)
      },
      async () => {
        events.push("deactivate")
        return 2
      },
    )

    expect(deactivated).toBe(2)
    expect(events).toEqual([
      "set:Graceful-Tools/astrid-web",
      "set:Graceful-Tools/astrid-ios",
      "deactivate",
    ])
  })

  it("leaves old tokens active when propagation fails", async () => {
    let deactivated = false

    await expect(propagateFixallMcpToken(
      "secret-in-memory",
      async repository => {
        if (repository.endsWith("astrid-ios")) throw new Error("GitHub rejected update")
      },
      async () => {
        deactivated = true
        return 1
      },
    )).rejects.toThrow(/GitHub rejected update/)

    expect(deactivated).toBe(false)
  })
})

describe("runSerializedFixallMcpRotation", () => {
  it("serializes concurrent publication so the deployed token remains active", async () => {
    let lockTail = Promise.resolve()
    const active = new Set(["token-a", "token-b"])
    const deployed = new Map<string, string>()

    const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
      const previous = lockTail
      let release = () => {}
      lockTail = new Promise<void>(resolve => {
        release = resolve
      })
      await previous
      try {
        return await operation()
      } finally {
        release()
      }
    }

    const rotate = (token: string) => runSerializedFixallMcpRotation(
      token,
      withLock,
      async () => {
        active.add(token)
      },
      async repository => {
        deployed.set(repository, token)
        await Promise.resolve()
      },
      async () => {
        let count = 0
        for (const candidate of [...active]) {
          if (candidate !== token) {
            active.delete(candidate)
            count += 1
          }
        }
        return count
      },
    )

    await Promise.all([rotate("token-a"), rotate("token-b")])

    expect([...deployed.values()]).toEqual(["token-b", "token-b"])
    expect([...active]).toEqual(["token-b"])
  })
})
