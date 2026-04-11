/**
 * Run migration on production database
 * Usage: npx tsx scripts/run-prod-migration.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'

async function main() {
  // Connect to production database
  const prodDbUrl = process.env.DATABASE_URL_DIRECT_PROD

  if (!prodDbUrl) {
    console.error('DATABASE_URL_DIRECT_PROD not found in environment')
    process.exit(1)
  }

  console.log('Connecting to production database...')

  const prisma = new PrismaClient()

  try {
    // Check if table already exists
    const tableExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'user_webhook_configs'
      );
    ` as { exists: boolean }[]

    if (tableExists[0]?.exists) {
      console.log('Table user_webhook_configs already exists')
      return
    }

    console.log('Creating user_webhook_configs table...')

    // Create table
    await prisma.$executeRaw`
      CREATE TABLE "user_webhook_configs" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "webhookUrl" TEXT NOT NULL,
        "webhookSecret" TEXT NOT NULL,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "events" TEXT[] DEFAULT ARRAY['task.assigned', 'comment.created']::TEXT[],
        "lastFiredAt" TIMESTAMP(3),
        "failureCount" INTEGER NOT NULL DEFAULT 0,
        "maxRetries" INTEGER NOT NULL DEFAULT 3,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "user_webhook_configs_pkey" PRIMARY KEY ("id")
      );
    `

    console.log('Creating indexes...')

    await prisma.$executeRaw`
      CREATE UNIQUE INDEX "user_webhook_configs_userId_key" ON "user_webhook_configs"("userId");
    `

    await prisma.$executeRaw`
      CREATE INDEX "user_webhook_configs_userId_idx" ON "user_webhook_configs"("userId");
    `

    await prisma.$executeRaw`
      CREATE INDEX "user_webhook_configs_enabled_idx" ON "user_webhook_configs"("enabled");
    `

    console.log('Adding foreign key...')

    await prisma.$executeRaw`
      ALTER TABLE "user_webhook_configs" ADD CONSTRAINT "user_webhook_configs_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    `

    console.log('Migration completed successfully!')

  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
