#!/usr/bin/env npx tsx

/**
 * Development Environment Setup Script
 *
 * This script helps developers configure their environment variables
 * for dynamic port usage in local development.
 */

import fs from 'fs'
import path from 'path'

interface DevConfig {
  port: number
  baseUrl: string
  nextAuthUrl: string
}

function detectCurrentPort(): number {
  // Try to read the port from package.json dev script
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const devScript = packageJson.scripts?.dev

    if (devScript && devScript.includes('-p ')) {
      const portMatch = devScript.match(/-p (\d+)/)
      if (portMatch) {
        return parseInt(portMatch[1], 10)
      }
    }
  } catch (error) {
    // Ignore errors, will use fallback
  }

  // Default detection - check common ports
  return 3000 // Default fallback
}

function getCurrentConfig(): DevConfig {
  const port = detectCurrentPort()
  const baseUrl = `http://localhost:${port}`

  return {
    port,
    baseUrl,
    nextAuthUrl: baseUrl
  }
}

function updateEnvLocal(config: DevConfig) {
  const envLocalPath = '.env.local'
  let envContent = ''

  // Read existing .env.local if it exists
  if (fs.existsSync(envLocalPath)) {
    envContent = fs.readFileSync(envLocalPath, 'utf8')
  }

  // Update or add NEXTAUTH_URL
  const nextAuthUrlPattern = /^NEXTAUTH_URL=.*$/m
  const newNextAuthUrl = `NEXTAUTH_URL=${config.nextAuthUrl}`

  if (nextAuthUrlPattern.test(envContent)) {
    envContent = envContent.replace(nextAuthUrlPattern, newNextAuthUrl)
    console.log(`📝 Updated NEXTAUTH_URL in ${envLocalPath}`)
  } else {
    envContent += `\n${newNextAuthUrl}\n`
    console.log(`➕ Added NEXTAUTH_URL to ${envLocalPath}`)
  }

  // Update or add NEXT_PUBLIC_BASE_URL
  const baseUrlPattern = /^NEXT_PUBLIC_BASE_URL=.*$/m
  const newBaseUrl = `NEXT_PUBLIC_BASE_URL=${config.baseUrl}`

  if (baseUrlPattern.test(envContent)) {
    envContent = envContent.replace(baseUrlPattern, newBaseUrl)
    console.log(`📝 Updated NEXT_PUBLIC_BASE_URL in ${envLocalPath}`)
  } else {
    envContent += `${newBaseUrl}\n`
    console.log(`➕ Added NEXT_PUBLIC_BASE_URL to ${envLocalPath}`)
  }

  // Write back to file
  fs.writeFileSync(envLocalPath, envContent)
}

function updateAIAgentWebhookUrls(config: DevConfig) {
  console.log(`\n🤖 To update AI agent webhook URLs, run:`)
  console.log(`\nDATABASE_URL="your_database_url" npx tsx -e "
import { createScriptPrisma } from './lib/script-prisma';
const prisma = createScriptPrisma();

async function updateWebhookUrls() {
  try {
    const result = await prisma.aIAgent.updateMany({
      where: {
        name: { in: ['Claude Code Agent', 'OpenAI Code Agent', 'Claude Analyst'] }
      },
      data: {
        webhookUrl: '${config.baseUrl}/api/ai-agent/webhook'
      }
    });

    console.log('✅ Updated webhook URLs for', result.count, 'agents to ${config.baseUrl}');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.\\$disconnect();
  }
}

updateWebhookUrls();
"`)
}

async function main() {
  console.log('🚀 Development Environment Setup\n')

  const config = getCurrentConfig()

  console.log('📊 Detected configuration:')
  console.log(`   Port: ${config.port}`)
  console.log(`   Base URL: ${config.baseUrl}`)
  console.log(`   NextAuth URL: ${config.nextAuthUrl}\n`)

  // Update .env.local
  updateEnvLocal(config)

  // Show instructions for AI agent webhook URLs
  updateAIAgentWebhookUrls(config)

  console.log(`\n✅ Environment setup complete!`)
  console.log(`\n💡 Tips:`)
  console.log(`   - Restart your dev server after changing .env.local`)
  console.log(`   - If you change ports, run this script again`)
  console.log(`   - For manual port override, set NEXTAUTH_URL directly in .env.local`)
}

if (require.main === module) {
  main().catch(console.error)
}

export { getCurrentConfig, updateEnvLocal }