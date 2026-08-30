#!/usr/bin/env tsx

import { randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import { mcpTokenStorageFields } from "@/lib/mcp-token"
import {
  FIXALL_AGENT_EMAIL,
  FIXALL_REPOSITORIES,
  parseFixallMcpRotationOptions,
  runSerializedFixallMcpRotation,
  validateFixallAgent,
} from "./lib/fixall-mcp-rotation"

const TOKEN_DESCRIPTION = "GitHub Actions fixall token"

function runGh(args: string[], stdin?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] })
    let stderr = ""

    child.stderr.setEncoding("utf8")
    child.stderr.on("data", chunk => {
      stderr += chunk
    })
    child.stdout.resume()
    child.on("error", reject)
    child.on("close", code => {
      if (code === 0) resolve()
      else reject(new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${stderr.trim() || `exit ${code}`}`))
    })

    if (stdin !== undefined) child.stdin.end(stdin)
    else child.stdin.end()
  })
}

async function main() {
  const options = parseFixallMcpRotationOptions(process.argv.slice(2))
  const databaseUrl = process.env[options.databaseUrlEnv]
  if (!databaseUrl) {
    throw new Error(`${options.databaseUrlEnv} is not set; this script never loads .env.local implicitly`)
  }
  if (options.mode === "apply" && !process.env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is required to store the MCP token encrypted")
  }

  process.env.DATABASE_URL = databaseUrl
  const { PrismaClient } = await import("@prisma/client")
  const prisma = new PrismaClient()

  try {
    const agent = await prisma.user.findUnique({
      where: { email: FIXALL_AGENT_EMAIL },
      select: { id: true, email: true, isAIAgent: true, isActive: true },
    })
    validateFixallAgent(agent)

    const activeTokenCount = await prisma.mCPToken.count({
      where: { userId: agent.id, isActive: true },
    })

    console.log(`Validated active fixall agent: ${FIXALL_AGENT_EMAIL}`)
    console.log(`Active agent tokens to replace after propagation: ${activeTokenCount}`)
    console.log(`GitHub repositories to update: ${FIXALL_REPOSITORIES.join(", ")}`)

    if (options.mode === "dry-run") {
      console.log("Dry run complete; no token was generated, stored, or sent to GitHub.")
      return
    }

    for (const repository of FIXALL_REPOSITORIES) {
      await runGh(["repo", "view", repository, "--json", "nameWithOwner"])
    }

    const plaintext = `astrid_mcp_${randomBytes(32).toString("hex")}`
    const stagedToken = await prisma.mCPToken.create({
      data: {
        ...mcpTokenStorageFields(plaintext),
        userId: agent.id,
        permissions: ["read", "write"],
        description: TOKEN_DESCRIPTION,
        isActive: true,
      },
      select: { id: true },
    })

    let propagationError: unknown
    const deactivatedCount = await prisma.$transaction(async tx => {
      let count = 0
      try {
        count = await runSerializedFixallMcpRotation(
          plaintext,
          async operation => {
            // Transaction-scoped lock serializes every rotation through both
            // GitHub writes and retirement, not merely the database updates.
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(730251, 1)`
            return operation()
          },
          async () => {
            await tx.mCPToken.update({
              where: { id: stagedToken.id },
              data: { isActive: true },
            })
          },
          async (repository, token) => {
            await runGh(["secret", "set", "ASTRID_MCP_TOKEN", "--repo", repository], token)
            console.log(`Updated ASTRID_MCP_TOKEN for ${repository}`)
          },
          async () => {
            const deactivated = await tx.mCPToken.updateMany({
              where: {
                userId: agent.id,
                isActive: true,
                id: { not: stagedToken.id },
              },
              data: { isActive: false },
            })
            return deactivated.count
          },
        )
      } catch (error) {
        // Commit the staged token as active on partial GitHub propagation.
        // A rerun can then converge both repositories without invalidating one
        // that already received this value.
        propagationError = error
      }
      return count
    }, {
      maxWait: 300_000,
      timeout: 300_000,
    })

    if (propagationError) {
      console.error(
        "GitHub propagation was incomplete. The staged token remains active so any successful repository update stays valid; rerun the command to converge both repositories.",
      )
      throw propagationError
    }

    console.log(`Rotation complete; deactivated ${deactivatedCount} superseded agent token(s).`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error(`Credential rotation failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
