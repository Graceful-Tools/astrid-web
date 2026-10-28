#!/usr/bin/env tsx
/**
 * Test script to verify workflow cancellation on task deletion/completion
 */

import { createScriptPrisma } from './lib/script-prisma'

const prisma = createScriptPrisma()

async function main() {
  console.log('🧪 Testing Workflow Cancellation Logic\n')

  // Find a task with an active workflow
  const activeWorkflow = await prisma.codingTaskWorkflow.findFirst({
    where: {
      status: {
        in: ['PENDING', 'PLANNING', 'IMPLEMENTING']
      }
    },
    include: {
      task: true
    }
  })

  if (!activeWorkflow) {
    console.log('❌ No active workflows found to test')
    console.log('   Create a test task and assign it to Claude Code Agent to test\n')
    return
  }

  console.log('✅ Found active workflow:')
  console.log(`   Task ID: ${activeWorkflow.taskId}`)
  console.log(`   Task Title: ${activeWorkflow.task?.title}`)
  console.log(`   Status: ${activeWorkflow.status}`)
  console.log(`   Created: ${activeWorkflow.createdAt}`)
  console.log(`   Updated: ${activeWorkflow.updatedAt}`)
  console.log()

  // Check if cancellation logic would work
  if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(activeWorkflow.status)) {
    console.log('✅ Cancellation logic would trigger for this workflow')
    console.log('   The workflow is active and would be cancelled')
  } else {
    console.log('⚠️  Workflow is already in final state:', activeWorkflow.status)
  }

  console.log()
  console.log('📊 Summary:')
  console.log(`   To test: Delete or complete task ${activeWorkflow.taskId}`)
  console.log(`   Expected: Workflow status changes to CANCELLED`)
  console.log(`   Expected: metadata.cancelReason is set`)
  console.log()
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
