/**
 * Add foreign key to user_webhook_configs
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'

async function main() {
  const prodDbUrl = process.env.DATABASE_URL_DIRECT_PROD

  if (!prodDbUrl) {
    console.error('DATABASE_URL_DIRECT_PROD not found')
    process.exit(1)
  }

  const prisma = new PrismaClient({
  })

  try {
    // Check if constraint exists
    const exists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'user_webhook_configs_userId_fkey'
      );
    ` as { exists: boolean }[]

    if (exists[0]?.exists) {
      console.log('Foreign key already exists')
      return
    }

    console.log('Adding foreign key...')
    await prisma.$executeRaw`
      ALTER TABLE "user_webhook_configs" ADD CONSTRAINT "user_webhook_configs_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    `
    console.log('Done!')

  } finally {
    await prisma.$disconnect()
  }
}

main()
