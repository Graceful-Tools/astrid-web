/**
 * Reset webhook failure count for a user
 * Run with: npx tsx scripts/reset-webhook-failures.ts <userId>
 */
import { prisma } from '../lib/prisma'

async function main() {
  const userId = process.argv[2] || 'cmeje966q0000k1045si7zrz3'

  console.log(`Resetting webhook failure count for user: ${userId}`)

  const result = await prisma.userWebhookConfig.updateMany({
    where: { userId },
    data: { failureCount: 0 }
  })
  console.log('Reset result:', result)

  const config = await prisma.userWebhookConfig.findUnique({
    where: { userId }
  })
  console.log('Current config:', JSON.stringify(config, null, 2))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
