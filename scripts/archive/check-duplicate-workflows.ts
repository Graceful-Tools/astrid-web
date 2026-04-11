#!/usr/bin/env npx tsx
/**
 * Check for duplicate workflow triggers
 * This script checks if multiple workflow records are being created for the same task
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkDuplicateWorkflows() {
  try {
    console.log('🔍 Checking for duplicate workflows...\n')

    // Find all coding task workflows grouped by task
    const workflows = await prisma.codingTaskWorkflow.findMany({
      include: {
        task: {
          select: {
            id: true,
            title: true,
            assigneeId: true,
            assignee: {
              select: {
                name: true,
                isAIAgent: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 50 // Last 50 workflows
    })

    console.log(`📊 Found ${workflows.length} total workflows\n`)

    // Group by task ID to find duplicates
    const workflowsByTask = new Map<string, typeof workflows>()

    for (const workflow of workflows) {
      const taskId = workflow.taskId
      if (!workflowsByTask.has(taskId)) {
        workflowsByTask.set(taskId, [])
      }
      workflowsByTask.get(taskId)!.push(workflow)
    }

    // Find tasks with multiple workflows
    const duplicates = Array.from(workflowsByTask.entries())
      .filter(([_, workflows]) => workflows.length > 1)
      .sort((a, b) => b[1].length - a[1].length)

    if (duplicates.length === 0) {
      console.log('✅ No duplicate workflows found! Each task has at most 1 workflow.\n')
    } else {
      console.log(`⚠️  Found ${duplicates.length} tasks with multiple workflows:\n`)

      for (const [taskId, taskWorkflows] of duplicates) {
        const task = taskWorkflows[0].task
        console.log(`📋 Task: "${task.title}" (${taskId})`)
        console.log(`   Assignee: ${task.assignee?.name || 'None'}`)
        console.log(`   Workflow count: ${taskWorkflows.length}`)
        console.log(`   Workflows:`)

        for (const wf of taskWorkflows) {
          const timeDiff = Date.now() - wf.createdAt.getTime()
          const seconds = Math.floor(timeDiff / 1000)
          console.log(`     - ID: ${wf.id}`)
          console.log(`       Status: ${wf.status}`)
          console.log(`       Created: ${wf.createdAt.toISOString()} (${seconds}s ago)`)
          console.log(`       Metadata: ${JSON.stringify(wf.metadata)}`)
        }
        console.log('')
      }
    }

    // Check for recent workflows created within 1 second of each other (likely duplicates)
    console.log('🕐 Checking for workflows created within 1 second of each other...\n')

    const recentDuplicates = Array.from(workflowsByTask.entries())
      .filter(([_, workflows]) => {
        if (workflows.length < 2) return false

        // Sort by creation time
        const sorted = workflows.sort((a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime()
        )

        // Check if any two consecutive workflows were created within 1 second
        for (let i = 0; i < sorted.length - 1; i++) {
          const timeDiff = sorted[i + 1].createdAt.getTime() - sorted[i].createdAt.getTime()
          if (timeDiff < 1000) {
            return true
          }
        }
        return false
      })

    if (recentDuplicates.length === 0) {
      console.log('✅ No workflows were created within 1 second of each other.\n')
    } else {
      console.log(`⚠️  Found ${recentDuplicates.length} tasks with workflows created within 1 second:\n`)

      for (const [taskId, taskWorkflows] of recentDuplicates) {
        const task = taskWorkflows[0].task
        const sorted = taskWorkflows.sort((a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime()
        )

        console.log(`📋 Task: "${task.title}" (${taskId})`)
        for (let i = 0; i < sorted.length - 1; i++) {
          const timeDiff = sorted[i + 1].createdAt.getTime() - sorted[i].createdAt.getTime()
          console.log(`   ⚡ ${timeDiff}ms between workflow ${i + 1} and ${i + 2}`)
        }
        console.log('')
      }
    }

    console.log('✅ Analysis complete!')

  } catch (error) {
    console.error('❌ Error checking workflows:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkDuplicateWorkflows()
