/**
 * Setup Webhook Config for Claude Code Remote
 *
 * Creates or updates the UserWebhookConfig to route tasks to the Fly.io server.
 * Run with: npx tsx scripts/setup-webhook-config.ts
 */

import { prisma } from '../lib/prisma'
import { encryptField } from '../lib/field-encryption'
import crypto from 'crypto'

const WEBHOOK_URL = process.env.CLAUDE_REMOTE_URL || 'https://astrid-claude-remote.fly.dev/webhook'

async function main() {
  // Find Jon's user account (task creator)
  const user = await prisma.user.findFirst({
    where: {
      email: 'jon@gracefultools.com'
    }
  })

  if (!user) {
    console.error('❌ User not found: jon@gracefultools.com')
    process.exit(1)
  }

  console.log(`👤 Found user: ${user.name} (${user.email})`)
  console.log(`📍 Webhook URL: ${WEBHOOK_URL}`)

  // Check existing config
  const existingConfig = await prisma.userWebhookConfig.findUnique({
    where: { userId: user.id }
  })

  if (existingConfig) {
    console.log(`📋 Existing config found, updating...`)
  } else {
    console.log(`📋 No existing config, creating new...`)
  }

  // Generate or reuse secret
  // Use the same secret as on Fly.io if provided, otherwise generate new
  const webhookSecret = process.env.ASTRID_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex')

  // Encrypt fields
  const encryptedUrl = encryptField(WEBHOOK_URL)
  const encryptedSecret = encryptField(webhookSecret)

  // Upsert config
  const config = await prisma.userWebhookConfig.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      webhookUrl: encryptedUrl,
      webhookSecret: encryptedSecret,
      enabled: true,
      events: ['task.assigned', 'comment.created'],
      maxRetries: 5
    },
    update: {
      webhookUrl: encryptedUrl,
      webhookSecret: encryptedSecret,
      enabled: true,
      events: ['task.assigned', 'comment.created'],
      failureCount: 0
    }
  })

  console.log(`\n✅ Webhook config ${existingConfig ? 'updated' : 'created'}!`)
  console.log(`\n📝 Config details:`)
  console.log(`   ID: ${config.id}`)
  console.log(`   User ID: ${config.userId}`)
  console.log(`   Enabled: ${config.enabled}`)
  console.log(`   Events: ${config.events.join(', ')}`)
  console.log(`   Failure Count: ${config.failureCount}`)

  if (!process.env.ASTRID_WEBHOOK_SECRET) {
    console.log(`\n⚠️  New webhook secret generated!`)
    console.log(`   Set this on your Fly.io server:`)
    console.log(`\n   flyctl secrets set ASTRID_WEBHOOK_SECRET="${webhookSecret}" --app astrid-claude-remote`)
  } else {
    console.log(`\n✅ Using existing ASTRID_WEBHOOK_SECRET from environment`)
  }

  console.log(`\n🎉 Done! Tasks assigned to Claude will now route to ${WEBHOOK_URL}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
