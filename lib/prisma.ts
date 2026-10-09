import { Prisma, PrismaClient } from "@prisma/client"
import { createLogger } from '@/lib/logger'

const log = createLogger('prisma')


const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// During build time, provide a mock Prisma client if DATABASE_URL is not available
// This prevents build failures while maintaining type safety
const createPrismaClient = () => {
  if (process.env.DATABASE_URL) {
    const client = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
      errorFormat: "pretty",
      datasources: {
        db: {
          url: process.env.DATABASE_URL
        }
      },
      transactionOptions: {
        timeout: 10000,
        maxWait: 5000,
      },
    })

    // A plain client. It used to be wrapped in a $extends query hook that
    // started AI-agent runs on any raw task.update({ assigneeId }) — a business
    // event hidden inside the database client. Agent dispatch now lives in
    // services/agent-assignment-dispatch.ts (spec §5.2 step 3).
    return client
  }

  // During build time, return a mock client that throws runtime errors
  // This allows static analysis to pass while preventing actual database calls during build
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
    log.warn("⚠️  DATABASE_URL not available during build - using mock Prisma client")
    return new Proxy({} as PrismaClient, {
      get() {
        throw new Error("Database not available - DATABASE_URL not configured")
      }
    })
  }

  throw new Error("Database connection not available. Make sure DATABASE_URL is set.")
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production" && prisma) {
  globalForPrisma.prisma = prisma
}

// Graceful shutdown
process.on("beforeExit", async () => {
  if (prisma && process.env.DATABASE_URL) {
    await prisma.$disconnect()
  }
})
