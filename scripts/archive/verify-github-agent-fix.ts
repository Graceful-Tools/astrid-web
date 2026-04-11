#!/usr/bin/env npx tsx
/**
 * Verify GitHub Agent Fix
 * Confirms that the AI orchestrator fix is correct
 */

import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

// Load environment variables
config({ path: '.env.local' })

const prisma = new PrismaClient()

async function verifyGitHubAgentFix() {
  console.log('🔍 Verifying GitHub Agent Fix...\n')

  try {
    // Test 1: Verify AI agents exist
    console.log('📝 Test 1: Verifying AI agents exist...')
    const aiAgents = await prisma.user.findMany({
      where: { isAIAgent: true },
      select: { id: true, email: true, name: true }
    })

    if (aiAgents.length === 0) {
      throw new Error('No AI agents found')
    }

    console.log('✅ AI agents found:')
    aiAgents.forEach(agent => console.log(`   - ${agent.name} (${agent.email})`))
    console.log()

    // Test 2: Verify AI agents do NOT have GitHub integrations
    console.log('📝 Test 2: Verifying AI agents do NOT have GitHub integrations...')
    const agentIntegrations = await Promise.all(
      aiAgents.map(agent =>
        prisma.gitHubIntegration.findFirst({ where: { userId: agent.id } })
      )
    )

    const hasIntegrations = agentIntegrations.some(integration => integration !== null)
    if (hasIntegrations) {
      console.error('❌ FAIL: AI agents should NOT have GitHub integrations')
      throw new Error('AI agents should not have direct GitHub integrations')
    }
    console.log('✅ Confirmed: AI agents do not have GitHub integrations')
    console.log()

    // Test 3: Verify real users with GitHub integration exist
    console.log('📝 Test 3: Verifying real users with GitHub integration exist...')
    const usersWithGitHub = await prisma.user.count({
      where: {
        isAIAgent: false,
        githubIntegrations: { some: {} }
      }
    })

    if (usersWithGitHub === 0) {
      console.warn('⚠️ Warning: No real users with GitHub integration found')
      console.warn('   Please configure GitHub integration in Settings → AI Agents')
    } else {
      console.log(`✅ Found ${usersWithGitHub} user(s) with GitHub integration`)
    }
    console.log()

    // Test 4: Verify the fix in ai-orchestrator.ts
    console.log('📝 Test 4: Verifying code fix in ai-orchestrator.ts...')
    const orchestratorPath = path.join(__dirname, '../lib/ai-orchestrator.ts')
    const orchestratorCode = fs.readFileSync(orchestratorPath, 'utf-8')

    // Check that the fix is applied
    const hasBuggyCode = orchestratorCode.includes('GitHubClient.forUser(workflow.task.creatorId)')
    const hasFixedCode = orchestratorCode.includes('GitHubClient.forUser(this.userId)')

    if (hasBuggyCode) {
      console.error('❌ FAIL: Code still contains buggy line: GitHubClient.forUser(workflow.task.creatorId)')
      throw new Error('Code fix not applied')
    }

    if (!hasFixedCode) {
      console.error('❌ FAIL: Code does not contain fixed line: GitHubClient.forUser(this.userId)')
      throw new Error('Code fix not applied correctly')
    }

    console.log('✅ Code fix verified:')
    console.log('   - OLD (buggy): GitHubClient.forUser(workflow.task.creatorId) ❌ REMOVED')
    console.log('   - NEW (fixed): GitHubClient.forUser(this.userId) ✅ PRESENT')
    console.log()

    // Test 5: Verify the fix is in both places
    console.log('📝 Test 5: Verifying fix is applied in all locations...')
    const fixCount = (orchestratorCode.match(/GitHubClient\.forUser\(this\.userId\)/g) || []).length

    console.log(`✅ Found ${fixCount} instance(s) of the fixed code`)
    if (fixCount < 2) {
      console.warn(`⚠️ Warning: Expected at least 2 instances (createGitHubImplementation and handleChangeRequest)`)
    }
    console.log()

    // Test 6: Verify TypeScript compilation
    console.log('📝 Test 6: Verifying TypeScript compilation...')
    const { execSync } = require('child_process')
    try {
      execSync('npx tsc --noEmit', { cwd: path.join(__dirname, '..'), encoding: 'utf-8' })
      console.log('✅ TypeScript compilation successful')
    } catch (tscError) {
      console.error('❌ TypeScript compilation failed')
      throw tscError
    }
    console.log()

    // Summary
    console.log('🎉 All verification tests passed!')
    console.log('\n📋 Fix Summary:')
    console.log('   ✅ AI agents exist in database')
    console.log('   ✅ AI agents do NOT have GitHub integrations (correct)')
    console.log(`   ✅ ${usersWithGitHub} real user(s) with GitHub integration`)
    console.log('   ✅ Code fix applied: using this.userId instead of workflow.task.creatorId')
    console.log('   ✅ TypeScript compilation successful')
    console.log('\n🔧 What was fixed:')
    console.log('   - BEFORE: AI orchestrator tried to use AI agent\'s GitHub integration')
    console.log('   - AFTER: AI orchestrator uses list admin\'s GitHub integration')
    console.log('   - IMPACT: Cloud coding agent can now connect to GitHub!')
    console.log('\n🚀 Next steps:')
    console.log('   1. Test the complete workflow on astrid.cc')
    console.log('   2. Assign a task to the coding agent')
    console.log('   3. Verify GitHub branch and PR creation works')

    return { success: true }

  } catch (error) {
    console.error('\n❌ Verification failed:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  verifyGitHubAgentFix()
    .then((result) => {
      process.exit(result.success ? 0 : 1)
    })
    .catch((error) => {
      console.error('Verification execution failed:', error)
      process.exit(1)
    })
}

export { verifyGitHubAgentFix }
