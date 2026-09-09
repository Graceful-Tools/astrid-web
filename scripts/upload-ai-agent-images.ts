/**
 * Upload AI agent profile images to object storage.
 * This ensures AI agents use the same image storage as regular users.
 */

import { putObject } from "@/lib/secure-storage"
import { PrismaClient } from "@prisma/client"
import * as fs from "fs"
import * as path from "path"

const prisma = new PrismaClient()

const AI_AGENTS = [
  { email: "claude@astrid.cc", filename: "claude.png", contentType: "image/png" },
  { email: "openai@astrid.cc", filename: "openai.png", contentType: "image/png" },
  { email: "gemini@astrid.cc", filename: "gemini.png", contentType: "image/png" },
  { email: "openclaw@astrid.cc", filename: "openclaw.svg", contentType: "image/svg+xml" },
]

async function uploadAgentImages() {
  console.log("🚀 Uploading AI agent images to Vercel Blob...")

  for (const agent of AI_AGENTS) {
    const localPath = path.join(process.cwd(), "public/images/ai-agents", agent.filename)

    if (!fs.existsSync(localPath)) {
      console.log(`❌ File not found: ${localPath}`)
      continue
    }

    console.log(`📤 Uploading ${agent.filename}...`)

    // Read the file
    const fileBuffer = fs.readFileSync(localPath)
    const file = new Blob([fileBuffer], { type: agent.contentType })

    const blob = await putObject(`ai-agents/${agent.filename}`, file as never, {
      contentType: agent.contentType,
    })

    console.log(`✅ Uploaded: ${blob.url}`)

    // Update database
    await prisma.user.update({
      where: { email: agent.email },
      data: { image: blob.url },
    })

    console.log(`✅ Updated database for ${agent.email}`)
  }

  // Verify
  const agents = await prisma.user.findMany({
    where: { isAIAgent: true },
    select: { name: true, email: true, image: true },
  })

  console.log("\n📋 AI Agent images after update:")
  console.log(JSON.stringify(agents, null, 2))
}

uploadAgentImages()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
