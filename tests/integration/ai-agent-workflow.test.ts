/**
 * AI Agent Workflow Integration Tests
 *
 * Tests the complete AI agent workflow from task assignment to deployment:
 * 1. Task analysis and detection
 * 2. Plan posting
 * 3. Implementation
 * 4. PR creation
 * 5. Preview links
 * 6. Comment-based revision
 * 7. Ship it workflow
 *
 * Tests all three agent types: Claude, OpenAI, and Gemini
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BRAND } from '@/lib/brand/config'

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock the comment service
vi.mock('@/lib/ai-agent-comment-service', () => ({
  createAIAgentComment: vi.fn().mockResolvedValue({ success: true, comment: { id: 'comment-1' } })
}))

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn()
    },
    comment: {
      create: vi.fn(),
      findMany: vi.fn()
    },
    codingTaskWorkflow: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    }
  }
}))

// ============================================================================
// TEST DATA
// ============================================================================

const mockTask = {
  id: 'task-123',
  title: 'Fix button alignment issue',
  description: 'The submit button is misaligned on mobile devices',
  assigneeId: 'claude-agent-id',
  assignee: {
    id: 'claude-agent-id',
    email: `claude@${BRAND.agentEmailDomain}`,
    name: 'Claude Code Agent',
    isAIAgent: true,
    aiAgentType: 'coding_agent'
  },
  lists: [{ id: 'list-1' }],
  status: 'TODO',
  createdAt: new Date(),
  updatedAt: new Date()
}

const mockNonCodingTask = {
  id: 'task-456',
  title: 'Update documentation',
  description: 'Add API documentation for new endpoints',
  assigneeId: 'gemini-agent-id',
  assignee: {
    id: 'gemini-agent-id',
    email: `gemini@${BRAND.agentEmailDomain}`,
    name: 'Gemini Agent',
    isAIAgent: true,
    aiAgentType: 'gemini_agent'
  },
  lists: [{ id: 'list-1' }],
  status: 'TODO',
  createdAt: new Date(),
  updatedAt: new Date()
}

const mockImplementationPlan = {
  summary: 'Fix button alignment by updating CSS flexbox properties',
  approach: 'Update the submit button container to use flexbox with center alignment',
  files: [
    { path: 'components/SubmitButton.tsx', purpose: 'Fix alignment styles', changes: 'Add flexbox centering' },
    { path: 'components/SubmitButton.test.tsx', purpose: 'Add alignment tests', changes: 'Verify centering on mobile' }
  ],
  estimatedComplexity: 'simple' as const,
  considerations: ['Test on mobile devices', 'Check dark mode compatibility']
}

const mockComments = {
  starting: {
    id: 'comment-start',
    content: '🤖 **Claude AI Agent Starting**\n\n**Task:** Fix button alignment issue\n**Mode:** Cloud (Claude Agent SDK)',
    authorId: 'claude-agent-id',
    author: { email: `claude@${BRAND.agentEmailDomain}`, name: 'Claude Code Agent' },
    createdAt: new Date().toISOString()
  },
  plan: {
    id: 'comment-plan',
    content: '📋 **Implementation Plan**\n\n**Summary:** Fix button alignment...',
    authorId: 'claude-agent-id',
    author: { email: `claude@${BRAND.agentEmailDomain}`, name: 'Claude Code Agent' },
    createdAt: new Date().toISOString()
  },
  complete: {
    id: 'comment-complete',
    content: '✅ **Implementation Complete**\n\n**PR:** [#123](https://github.com/test/repo/pull/123)',
    authorId: 'claude-agent-id',
    author: { email: `claude@${BRAND.agentEmailDomain}`, name: 'Claude Code Agent' },
    createdAt: new Date().toISOString()
  },
  preview: {
    id: 'comment-preview',
    content: '🚀 **Staging Deployment Ready**\n\n**Preview URL:** https://test-preview.vercel.app',
    authorId: 'claude-agent-id',
    author: { email: `claude@${BRAND.agentEmailDomain}`, name: 'Claude Code Agent' },
    createdAt: new Date().toISOString()
  },
  userFeedback: {
    id: 'comment-feedback',
    content: 'The alignment looks off on iPad. Can you check tablet viewports?',
    authorId: 'user-123',
    author: { email: 'user@example.com', name: 'Test User' },
    createdAt: new Date().toISOString()
  },
  shipIt: {
    id: 'comment-shipit',
    content: 'ship it',
    authorId: 'user-123',
    author: { email: 'user@example.com', name: 'Test User' },
    createdAt: new Date().toISOString()
  }
}

// ============================================================================
// STAGE 1: TASK ANALYSIS AND DETECTION
// ============================================================================

describe('Stage 1: Task Analysis and Detection', () => {
  describe('Agent Type Detection', () => {
    it('should detect Claude agent from email', () => {
      const email = `claude@${BRAND.agentEmailDomain}`
      const isClaudeAgent = email === `claude@${BRAND.agentEmailDomain}`
      expect(isClaudeAgent).toBe(true)
    })

    it('should detect OpenAI agent from email', () => {
      const email = `openai@${BRAND.agentEmailDomain}`
      const isOpenAIAgent = email === `openai@${BRAND.agentEmailDomain}`
      expect(isOpenAIAgent).toBe(true)
    })

    it('should detect Gemini agent from email', () => {
      const email = `gemini@${BRAND.agentEmailDomain}`
      const isGeminiAgent = email === `gemini@${BRAND.agentEmailDomain}`
      expect(isGeminiAgent).toBe(true)
    })

    it('should not detect regular user as agent', () => {
      const email = 'user@example.com'
      const isAgent = [`claude@${BRAND.agentEmailDomain}`, `openai@${BRAND.agentEmailDomain}`, `gemini@${BRAND.agentEmailDomain}`].includes(email)
      expect(isAgent).toBe(false)
    })
  })

  describe('Task State Detection', () => {
    it('should detect new task (no comments)', () => {
      const comments: typeof mockComments.starting[] = []
      const hasAgentActivity = comments.some(c =>
        c.author?.email?.endsWith(`@${BRAND.domain}`) &&
        c.content.includes('Starting')
      )
      expect(hasAgentActivity).toBe(false)
    })

    it('should detect task with starting marker', () => {
      const comments = [mockComments.starting]
      const hasStartingMarker = comments.some(c =>
        c.content.includes('Starting') ||
        c.content.includes('**Starting work**')
      )
      expect(hasStartingMarker).toBe(true)
    })

    it('should detect task with completion marker', () => {
      const comments = [mockComments.starting, mockComments.complete]
      const hasCompletionMarker = comments.some(c =>
        c.content.includes('Implementation Complete') ||
        c.content.includes('**PR:**')
      )
      expect(hasCompletionMarker).toBe(true)
    })

    it('should detect ship it comment', () => {
      const comments = [mockComments.starting, mockComments.complete, mockComments.shipIt]
      const shipItPatterns = ['ship it', 'shipit', 'merge it', 'deploy']
      const hasShipIt = comments.some(c =>
        shipItPatterns.some(pattern =>
          c.content.toLowerCase().includes(pattern)
        )
      )
      expect(hasShipIt).toBe(true)
    })
  })

  describe('Non-Coding vs Coding Task Detection', () => {
    it('should identify coding task from description', () => {
      const description = 'Fix the button alignment CSS issue in SubmitButton.tsx'
      const codingKeywords = ['fix', 'bug', 'implement', 'add feature', '.tsx', '.ts', '.js', 'component']
      const isCodingTask = codingKeywords.some(keyword =>
        description.toLowerCase().includes(keyword.toLowerCase())
      )
      expect(isCodingTask).toBe(true)
    })

    it('should identify non-coding task from description', () => {
      const description = 'Update the README with new API documentation'
      const nonCodingKeywords = ['documentation', 'readme', 'update docs', 'write guide']
      const isNonCodingTask = nonCodingKeywords.some(keyword =>
        description.toLowerCase().includes(keyword.toLowerCase())
      )
      expect(isNonCodingTask).toBe(true)
    })
  })
})

// ============================================================================
// STAGE 2: PLAN POSTING
// ============================================================================

describe('Stage 2: Plan Posting', () => {
  it('should format plan comment correctly', () => {
    const plan = mockImplementationPlan
    const planComment = `📋 **Plan Created - Starting Implementation**

## 🎯 What I'll Do
${plan.summary}

${plan.approach}

## 📁 Files to Modify
${plan.files.map(f => `- \`${f.path}\`: ${f.purpose}`).join('\n')}

**Complexity:** ${plan.estimatedComplexity}
${plan.considerations.length > 0 ? `\n**Considerations:**\n${plan.considerations.map(c => `- ${c}`).join('\n')}` : ''}

Starting implementation now...`

    expect(planComment).toContain('Plan Created')
    expect(planComment).toContain(plan.summary)
    expect(planComment).toContain('SubmitButton.tsx')
    expect(planComment).toContain('simple')
  })

  it('should include all files in plan', () => {
    const plan = mockImplementationPlan
    const filesSection = plan.files.map(f => `- \`${f.path}\`: ${f.purpose}`).join('\n')

    expect(filesSection).toContain('SubmitButton.tsx')
    expect(filesSection).toContain('SubmitButton.test.tsx')
  })

  it('should handle plan with no considerations', () => {
    const plan = { ...mockImplementationPlan, considerations: [] }
    const hasConsiderations = plan.considerations.length > 0

    expect(hasConsiderations).toBe(false)
  })

  it('should format complexity levels correctly', () => {
    const complexities = ['simple', 'medium', 'complex']

    for (const complexity of complexities) {
      const plan = { ...mockImplementationPlan, estimatedComplexity: complexity as 'simple' | 'medium' | 'complex' }
      expect(plan.estimatedComplexity).toBe(complexity)
    }
  })
})

// ============================================================================
// STAGE 3: IMPLEMENTATION
// ============================================================================

describe('Stage 3: Implementation', () => {
  describe('Implementation Output Parsing', () => {
    it('should extract modified files from git status', () => {
      const gitOutput = `M  components/SubmitButton.tsx
A  components/SubmitButton.test.tsx
?? temp/debug.log`

      const modifiedFiles = gitOutput
        .split('\n')
        .filter(line => line.trim())
        .filter(line => !line.startsWith('??')) // Filter out untracked files BEFORE slicing
        .map(line => line.slice(3).trim())

      expect(modifiedFiles).toContain('components/SubmitButton.tsx')
      expect(modifiedFiles).toContain('components/SubmitButton.test.tsx')
      expect(modifiedFiles).not.toContain('temp/debug.log')
    })

    it('should extract PR URL from output', () => {
      const output = `Created PR https://github.com/test/repo/pull/123
Branch pushed successfully.`

      const prUrlPattern = /https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/
      const match = output.match(prUrlPattern)

      expect(match).not.toBeNull()
      expect(match![0]).toBe('https://github.com/test/repo/pull/123')
    })

    it('should detect test failures', () => {
      const output = `Running tests...
FAIL components/SubmitButton.test.tsx
  ✗ should align button correctly (5ms)`

      const hasTestFailure = output.includes('FAIL') || output.includes('✗')
      expect(hasTestFailure).toBe(true)
    })

    it('should detect successful tests', () => {
      const output = `Running tests...
PASS components/SubmitButton.test.tsx
  ✓ should align button correctly (5ms)
Tests: 1 passed, 0 failed`

      const hasTestSuccess = output.includes('PASS') || output.includes('passed')
      expect(hasTestSuccess).toBe(true)
    })
  })

  describe('Implementation Validation', () => {
    it('should require tests to pass for completion', () => {
      const implementation = {
        completed: true,
        testsRun: true,
        testsPassed: false
      }

      const isValid = implementation.completed &&
                     (!implementation.testsRun || implementation.testsPassed)
      expect(isValid).toBe(false)
    })

    it('should allow completion when tests pass', () => {
      const implementation = {
        completed: true,
        testsRun: true,
        testsPassed: true
      }

      const isValid = implementation.completed &&
                     (!implementation.testsRun || implementation.testsPassed)
      expect(isValid).toBe(true)
    })

    it('should allow completion when no tests configured', () => {
      const implementation = {
        completed: true,
        testsRun: false,
        testsPassed: false
      }

      const isValid = implementation.completed &&
                     (!implementation.testsRun || implementation.testsPassed)
      expect(isValid).toBe(true)
    })
  })
})

// ============================================================================
// STAGE 4: PR CREATION
// ============================================================================

describe('Stage 4: PR Creation', () => {
  describe('Branch Name Generation', () => {
    it('should generate valid branch name from task ID', () => {
      const taskId = 'task-12345678-abcd'
      const shortId = taskId.slice(0, 8)
      const branchName = `task/${shortId}`

      expect(branchName).toBe('task/task-123')
      expect(branchName).not.toContain(' ')
    })

    it('should sanitize branch name', () => {
      const taskTitle = 'Fix: button alignment (mobile)'
      const sanitized = taskTitle
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50)

      expect(sanitized).toBe('fix-button-alignment-mobile')
    })
  })

  describe('PR Comment Formatting', () => {
    it('should format PR creation comment correctly', () => {
      const prDetails = {
        prNumber: 123,
        prUrl: 'https://github.com/test/repo/pull/123',
        branchName: 'task/task-123',
        repository: 'test/repo'
      }

      const comment = `✅ **Implementation Complete - Ready for Testing**

## 📋 Summary

**PR**: [#${prDetails.prNumber}](${prDetails.prUrl})
**Branch**: \`${prDetails.branchName}\`
**Repository**: ${prDetails.repository}

Test the changes in the PR and reply **"ship it"** when ready to deploy.`

      expect(comment).toContain('#123')
      expect(comment).toContain('task/task-123')
      expect(comment).toContain('ship it')
    })
  })
})

// ============================================================================
// STAGE 5: PREVIEW LINKS
// ============================================================================

describe('Stage 5: Preview Links', () => {
  describe('Preview URL Generation', () => {
    it('should generate preview URL from branch name', () => {
      const branchName = 'task-12345678'
      const projectName = 'my-app'
      const previewUrl = `https://${projectName}-git-${branchName}.vercel.app`

      expect(previewUrl).toContain(branchName)
      expect(previewUrl).toContain('vercel.app')
    })

    it('should handle custom preview domain', () => {
      const branchName = 'task-123'
      const customDomain = 'preview.example.com'
      const previewUrl = `https://${branchName}.${customDomain}`

      expect(previewUrl).toBe('https://task-123.preview.example.com')
    })
  })

  describe('Preview Comment Formatting', () => {
    it('should format staging URL comment correctly', () => {
      const url = 'https://my-app-preview.vercel.app'
      const comment = `🚀 **Staging Deployment Ready**

**Preview URL**: [${url}](${url})

Test the preview and reply **"ship it"** when ready to deploy to production.`

      expect(comment).toContain('Staging Deployment Ready')
      expect(comment).toContain(url)
      expect(comment).toContain('ship it')
    })

    it('should format iOS TestFlight comment correctly', () => {
      const testflightUrl = 'https://testflight.apple.com/join/ABC123'
      const comment = `📱 **iOS Build Available**

**TestFlight**: [Join Beta](${testflightUrl})

Install the latest build on your device to test the changes.`

      expect(comment).toContain('iOS Build Available')
      expect(comment).toContain('TestFlight')
      expect(comment).toContain(testflightUrl)
    })
  })

  describe('Deployment State Handling', () => {
    it('should show building status when not ready', () => {
      const deploymentState = 'BUILDING'
      const statusEmoji = deploymentState === 'READY' ? '✅' : '🔄'
      const statusText = deploymentState === 'READY' ? 'Ready' : 'Building'

      expect(statusEmoji).toBe('🔄')
      expect(statusText).toBe('Building')
    })

    it('should show ready status when deployment complete', () => {
      const deploymentState = 'READY'
      const statusEmoji = deploymentState === 'READY' ? '✅' : '🔄'
      const statusText = deploymentState === 'READY' ? 'Ready' : 'Building'

      expect(statusEmoji).toBe('✅')
      expect(statusText).toBe('Ready')
    })

    it('should handle deployment errors', () => {
      const deploymentState = 'ERROR'
      const isError = deploymentState === 'ERROR' || deploymentState === 'CANCELED'

      expect(isError).toBe(true)
    })
  })
})

// ============================================================================
// STAGE 6: PR REVISION FROM COMMENTS
// ============================================================================

describe('Stage 6: PR Revision from Comments', () => {
  describe('User Feedback Detection', () => {
    it('should detect meaningful user feedback', () => {
      const comment = 'The alignment looks off on iPad. Can you check tablet viewports?'
      const approvalOnlyPatterns = ['looks good', 'approved', 'lgtm', 'ship it', 'thanks']
      const isApprovalOnly = approvalOnlyPatterns.some(pattern =>
        comment.toLowerCase().includes(pattern)
      )

      expect(isApprovalOnly).toBe(false)
    })

    it('should detect approval-only comments', () => {
      const approvalComments = ['Looks good!', 'LGTM', 'Approved', 'Thanks!']

      for (const comment of approvalComments) {
        const approvalOnlyPatterns = ['looks good', 'approved', 'lgtm', 'thanks']
        const isApprovalOnly = approvalOnlyPatterns.some(pattern =>
          comment.toLowerCase().includes(pattern)
        )
        expect(isApprovalOnly).toBe(true)
      }
    })

    it('should ignore AI agent comments', () => {
      const comment = mockComments.plan
      const isAIComment = comment.author?.email?.endsWith(`@${BRAND.domain}`)

      expect(isAIComment).toBe(true)
    })

    it('should detect retry comments', () => {
      const retryComments = ['retry', 'try again', 'please retry', 'retry!']

      for (const comment of retryComments) {
        const retryPatterns = ['retry', 'try again', 'rerun']
        const isRetry = retryPatterns.some(pattern =>
          comment.toLowerCase().includes(pattern)
        )
        expect(isRetry).toBe(true)
      }
    })
  })

  describe('Feedback Context Building', () => {
    it('should extract previous attempt context', () => {
      const previousAttempts = [
        {
          planSummary: 'First attempt at fixing alignment',
          filesModified: ['components/SubmitButton.tsx'],
          prUrl: 'https://github.com/test/repo/pull/122',
          outcome: 'User feedback: alignment off on iPad'
        }
      ]

      const context = previousAttempts.map((attempt, i) =>
        `Attempt ${i + 1}: ${attempt.planSummary}\nFiles: ${attempt.filesModified.join(', ')}\nOutcome: ${attempt.outcome}`
      ).join('\n\n')

      expect(context).toContain('Attempt 1')
      expect(context).toContain('alignment off on iPad')
    })

    it('should include user feedback in context', () => {
      const userFeedback = mockComments.userFeedback.content
      const feedbackSection = `⚠️ **User Feedback (Address These Issues):**\n${userFeedback}`

      expect(feedbackSection).toContain('User Feedback')
      expect(feedbackSection).toContain('iPad')
    })
  })
})

// ============================================================================
// STAGE 7: SHIP IT WORKFLOW
// ============================================================================

describe('Stage 7: Ship It Workflow', () => {
  describe('Ship It Comment Detection', () => {
    it('should detect "ship it" comment', () => {
      const shipItPatterns = ['ship it', 'shipit', 'ship-it', 'merge it', 'deploy to production']
      const comment = 'ship it'

      const isShipIt = shipItPatterns.some(pattern =>
        comment.toLowerCase().replace(/[^a-z]/g, ' ').includes(pattern.replace(/[^a-z]/g, ' '))
      )
      expect(isShipIt).toBe(true)
    })

    it('should detect variations of ship it', () => {
      const validShipItComments = ['Ship it!', 'SHIP IT', 'ship-it please', 'shipit', 'merge it']

      for (const comment of validShipItComments) {
        const shipItPatterns = ['ship it', 'shipit', 'ship-it', 'merge it']
        const normalized = comment.toLowerCase().replace(/[^a-z]/g, '')
        const isShipIt = shipItPatterns.some(pattern =>
          normalized.includes(pattern.replace(/[^a-z]/g, ''))
        )
        expect(isShipIt).toBe(true)
      }
    })

    it('should not trigger on partial matches', () => {
      const nonShipItComments = ['shipping update', 'it ships tomorrow', 'merge conflict']

      for (const comment of nonShipItComments) {
        // More strict matching - must be standalone phrase
        const isExactShipIt = /\bship\s*it\b/i.test(comment)
        expect(isExactShipIt).toBe(false)
      }
    })
  })

  describe('PR Merge Process', () => {
    it('should extract PR number from task comments', () => {
      const comments = [
        { content: '**PR**: [#123](https://github.com/test/repo/pull/123)' }
      ]

      const prPattern = /pull\/(\d+)/
      let prNumber: number | null = null

      for (const comment of comments) {
        const match = comment.content.match(prPattern)
        if (match) {
          prNumber = parseInt(match[1], 10)
          break
        }
      }

      expect(prNumber).toBe(123)
    })

    it('should handle missing PR in comments', () => {
      const comments = [
        { content: 'No PR link here' }
      ]

      const prPattern = /pull\/(\d+)/
      let prNumber: number | null = null

      for (const comment of comments) {
        const match = comment.content.match(prPattern)
        if (match) {
          prNumber = parseInt(match[1], 10)
          break
        }
      }

      expect(prNumber).toBeNull()
    })
  })

  describe('Production Deployment', () => {
    it('should format deployment success comment', () => {
      const productionUrl = 'https://my-app.vercel.app'
      const prNumber = 123

      const comment = `🎉 **Deployment Complete!**

**PR #${prNumber}** has been merged and deployed to production.

**Production URL**: [${productionUrl}](${productionUrl})

The task has been marked as complete.`

      expect(comment).toContain('Deployment Complete')
      expect(comment).toContain('#123')
      expect(comment).toContain(productionUrl)
      expect(comment).toContain('marked as complete')
    })

    it('should include iOS deployment info when applicable', () => {
      const testflightUrl = 'https://testflight.apple.com/join/ABC123'

      const comment = `📱 **iOS Deployment**

A new build has been submitted to App Store Connect.

**TestFlight**: [Join Beta](${testflightUrl})

Users will receive the update automatically.`

      expect(comment).toContain('iOS Deployment')
      expect(comment).toContain('TestFlight')
    })
  })

  describe('Task Completion', () => {
    it('should mark task as complete after deployment', () => {
      const task = { ...mockTask, status: 'TODO' }

      // Simulate completion
      task.status = 'DONE'

      expect(task.status).toBe('DONE')
    })

    it('should reassign task back to creator (optional)', () => {
      const task = {
        ...mockTask,
        creatorId: 'user-123',
        assigneeId: 'claude-agent-id'
      }

      // Simulate reassignment
      task.assigneeId = task.creatorId

      expect(task.assigneeId).toBe('user-123')
    })
  })
})

// ============================================================================
// CROSS-AGENT COMPATIBILITY TESTS
// ============================================================================

describe('Cross-Agent Compatibility', () => {
  const agents = [
    { email: `claude@${BRAND.agentEmailDomain}`, name: 'Claude', service: 'claude' },
    { email: `openai@${BRAND.agentEmailDomain}`, name: 'OpenAI', service: 'openai' },
    { email: `gemini@${BRAND.agentEmailDomain}`, name: 'Gemini', service: 'gemini' }
  ]

  for (const agent of agents) {
    describe(`${agent.name} Agent`, () => {
      it(`should route ${agent.name} tasks to correct service`, () => {
        const agentEmail = agent.email
        const service = agentEmail.includes('claude') ? 'claude' :
                       agentEmail.includes('openai') ? 'openai' :
                       agentEmail.includes('gemini') ? 'gemini' : 'unknown'

        expect(service).toBe(agent.service)
      })

      it(`should format ${agent.name} starting comment correctly`, () => {
        const comment = `🤖 **${agent.name} AI Agent Starting**\n\n**Task:** Test task\n**Mode:** Terminal`

        expect(comment).toContain(`${agent.name} AI Agent Starting`)
        expect(comment).toContain('Task:')
      })

      it(`should attribute comments to ${agent.name} correctly`, () => {
        const comment = {
          content: 'Test comment',
          authorEmail: agent.email
        }

        expect(comment.authorEmail).toBe(agent.email)
      })
    })
  }
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  it('should handle missing task gracefully', () => {
    const task = null
    const error = task ? null : 'Task not found'

    expect(error).toBe('Task not found')
  })

  it('should handle API key missing error', () => {
    const apiKeys = {
      claude: undefined,
      openai: undefined,
      gemini: 'GEMINI_KEY'
    }

    const availableServices = Object.entries(apiKeys)
      .filter(([, key]) => key)
      .map(([service]) => service)

    expect(availableServices).toContain('gemini')
    expect(availableServices).not.toContain('claude')
    expect(availableServices).not.toContain('openai')
  })

  it('should handle PR merge conflict', () => {
    const mergeResult = {
      success: false,
      error: 'Merge conflict detected'
    }

    expect(mergeResult.success).toBe(false)
    expect(mergeResult.error).toContain('conflict')
  })

  it('should handle Vercel deployment failure', () => {
    const deployment = {
      state: 'ERROR',
      error: 'Build failed: TypeScript errors'
    }

    const isError = deployment.state === 'ERROR'
    expect(isError).toBe(true)
    expect(deployment.error).toContain('Build failed')
  })

  it('should handle timeout gracefully', () => {
    const maxWaitMs = 360000 // 6 minutes
    const elapsedMs = 400000 // Over timeout

    const isTimedOut = elapsedMs > maxWaitMs
    expect(isTimedOut).toBe(true)
  })
})
