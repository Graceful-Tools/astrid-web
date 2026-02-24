#!/usr/bin/env tsx

/**
 * Self-Healing Pre-Deploy Script
 *
 * This script implements an agentic self-healing workflow that:
 * 1. Runs all quality checks
 * 2. Analyzes failures and determines fixes
 * 3. Applies auto-fixes where possible
 * 4. Re-runs failed checks (up to maxRetries)
 * 5. Creates Astrid tasks for issues that can't be auto-fixed
 * 6. Provides detailed reports on what was fixed/escalated
 *
 * Usage:
 *   npm run predeploy:self-healing        # Run with auto-fix
 *   npm run predeploy:self-healing --dry  # Analyze only, no fixes
 *   npm run predeploy:self-healing --ci   # CI mode (create tasks, exit 1 on failure)
 */

import { execSync, spawnSync, SpawnSyncReturns } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import dotenv from 'dotenv'

// Save original environment BEFORE dotenv loads, to use for build commands
// This prevents dotenv-loaded variables from affecting the Next.js build
const originalEnv = { ...process.env }

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// Configuration - customize for your project
const CONFIG = {
  maxRetries: 3,
  astridListId: process.env.ASTRID_BUGS_LIST_ID || 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba', // Bugs & Polish list
  createTasks: true,
  verboseOutput: true,
}

interface TestStats {
  passed: number
  failed: number
  skipped: number
  total: number
}

interface CheckResult {
  name: string
  command: string
  passed: boolean
  output: string
  duration: number
  autoFixable: boolean
  fixCommand?: string
  fixDescription?: string
  testStats?: TestStats
}

interface FixAttempt {
  check: string
  fixCommand: string
  success: boolean
  output: string
}

class SelfHealingPredeploy {
  private results: CheckResult[] = []
  private fixAttempts: FixAttempt[] = []
  private startTime = Date.now()

  /**
   * Parse Vitest output to extract test statistics
   */
  private parseVitestOutput(output: string): TestStats | undefined {
    // Match patterns like:
    // "Tests  1735 passed | 1 skipped (1736)"
    // "Tests  5 failed | 1730 passed (1735)"
    // "Tests  5 failed | 1730 passed | 2 skipped (1737)"
    let passed = 0
    let failed = 0
    let skipped = 0
    let total = 0

    // Look for the Tests summary line - be flexible with whitespace
    const testsLine = output.match(/Tests\s+.*\((\d+)\)/m)
    if (testsLine) {
      total = parseInt(testsLine[1], 10)

      // Parse individual counts from the line
      const passedMatch = testsLine[0].match(/(\d+)\s+passed/)
      const failedMatch = testsLine[0].match(/(\d+)\s+failed/)
      const skippedMatch = testsLine[0].match(/(\d+)\s+skipped/)

      if (passedMatch) passed = parseInt(passedMatch[1], 10)
      if (failedMatch) failed = parseInt(failedMatch[1], 10)
      if (skippedMatch) skipped = parseInt(skippedMatch[1], 10)

      return { passed, failed, skipped, total }
    }

    return undefined
  }

  /**
   * Parse Playwright E2E output to extract test statistics
   */
  private parsePlaywrightOutput(output: string): TestStats | undefined {
    // Match patterns like:
    // "15 passed (30s)"
    // "3 failed, 12 passed (25s)"
    // "2 skipped, 13 passed (28s)"
    const passedMatch = output.match(/(\d+)\s+passed/)
    const failedMatch = output.match(/(\d+)\s+failed/)
    const skippedMatch = output.match(/(\d+)\s+skipped/)

    if (passedMatch || failedMatch) {
      const passed = parseInt(passedMatch?.[1] || '0', 10)
      const failed = parseInt(failedMatch?.[1] || '0', 10)
      const skipped = parseInt(skippedMatch?.[1] || '0', 10)
      const total = passed + failed + skipped

      return { passed, failed, skipped, total }
    }

    return undefined
  }

  /**
   * Parse iOS test output to extract test statistics
   */
  private parseIOSTestOutput(output: string): TestStats | undefined {
    // Match patterns like:
    // "Test case 'TaskModelTests.testCreateMinimalTask()' passed"
    // "** TEST SUCCEEDED **" or "** TEST FAILED **"
    const passedTests = (output.match(/Test case .* passed/g) || []).length
    const failedTests = (output.match(/Test case .* failed/g) || []).length

    if (passedTests > 0 || failedTests > 0) {
      return {
        passed: passedTests,
        failed: failedTests,
        skipped: 0,
        total: passedTests + failedTests,
      }
    }

    return undefined
  }

  /**
   * Define all checks with their auto-fix commands
   */
  private getChecks(): Omit<CheckResult, 'passed' | 'output' | 'duration'>[] {
    return [
      // Quick checks first
      {
        name: 'TypeScript',
        command: 'npx tsc --noEmit',
        autoFixable: false, // Type errors need manual fix
      },
      {
        name: 'ESLint',
        command: 'npm run lint',
        autoFixable: true,
        fixCommand: 'npm run lint -- --fix',
        fixDescription: 'Auto-fix lint errors',
      },
      {
        name: 'Model Sync',
        command: 'npm run check:model-sync',
        autoFixable: false,
      },
      {
        name: 'API Breaking Changes',
        command: 'npm run check:api-breaking',
        autoFixable: false,
      },
      {
        name: 'Prisma Client',
        command: 'node -e "require(\'@prisma/client\')"',
        autoFixable: true,
        fixCommand: 'npx prisma generate',
        fixDescription: 'Regenerate Prisma client',
      },
      {
        name: 'Unit Tests (Vitest)',
        command: 'npm run test:run',
        autoFixable: false, // Test failures need investigation
      },
      {
        name: 'Build',
        command: 'npm run build:next',
        autoFixable: true,
        fixCommand: 'rm -rf .next && npm run build:next',
        fixDescription: 'Clean build cache and rebuild',
      },
    ]
  }

  /**
   * Parse test stats from output based on check type
   */
  private parseTestStats(checkName: string, output: string): TestStats | undefined {
    if (checkName.includes('Vitest') || checkName.includes('Unit Tests')) {
      return this.parseVitestOutput(output)
    }
    if (checkName.includes('E2E') || checkName.includes('Playwright')) {
      return this.parsePlaywrightOutput(output)
    }
    if (checkName.includes('iOS')) {
      return this.parseIOSTestOutput(output)
    }
    return undefined
  }

  /**
   * Format test stats for display
   */
  private formatTestStats(stats: TestStats): string {
    const parts: string[] = []
    if (stats.failed > 0) parts.push(`${stats.failed} failed`)
    if (stats.passed > 0) parts.push(`${stats.passed} passed`)
    if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`)
    return `${parts.join(', ')} (${stats.total} total)`
  }

  /**
   * Run a single check and capture results
   */
  private runCheck(check: Omit<CheckResult, 'passed' | 'output' | 'duration'>): CheckResult {
    const start = Date.now()

    if (CONFIG.verboseOutput) {
      console.log(`\n🔍 Running: ${check.name}...`)
    }

    try {
      // Use originalEnv (before dotenv loaded) to avoid polluting build with .env.local variables
      // This fixes the "Cannot read properties of null (reading 'useContext')" error
      const output = execSync(check.command, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 300000, // 5 minute timeout
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
        env: { ...originalEnv, FORCE_COLOR: '0', CI: 'true', NO_COLOR: '1' },
      })

      const duration = Date.now() - start
      const testStats = this.parseTestStats(check.name, output)

      if (CONFIG.verboseOutput) {
        let message = `   ✅ ${check.name} passed (${(duration / 1000).toFixed(1)}s)`
        if (testStats) {
          message += ` - ${this.formatTestStats(testStats)}`
        }
        console.log(message)
      }

      return {
        ...check,
        passed: true,
        output: output || '',
        duration,
        testStats,
      }
    } catch (error: any) {
      const duration = Date.now() - start
      const output = error.stdout || error.stderr || error.message || ''
      const testStats = this.parseTestStats(check.name, output)

      if (CONFIG.verboseOutput) {
        let message = `   ❌ ${check.name} failed (${(duration / 1000).toFixed(1)}s)`
        if (testStats) {
          message += ` - ${this.formatTestStats(testStats)}`
        }
        console.log(message)
      }

      return {
        ...check,
        passed: false,
        output,
        duration,
        testStats,
      }
    }
  }

  /**
   * Attempt to auto-fix a failed check
   */
  private attemptFix(result: CheckResult): FixAttempt {
    console.log(`\n🔧 Attempting auto-fix: ${result.fixDescription}`)
    console.log(`   Command: ${result.fixCommand}`)

    try {
      // Use originalEnv to avoid polluting fix commands with .env.local variables
      const output = execSync(result.fixCommand!, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 300000,
        env: { ...originalEnv, FORCE_COLOR: '0' },
      })

      console.log(`   ✅ Fix applied successfully`)

      return {
        check: result.name,
        fixCommand: result.fixCommand!,
        success: true,
        output: output || '',
      }
    } catch (error: any) {
      const output = error.stdout || error.stderr || error.message || ''
      console.log(`   ❌ Fix failed`)

      return {
        check: result.name,
        fixCommand: result.fixCommand!,
        success: false,
        output,
      }
    }
  }

  /**
   * Get OAuth token for Astrid API
   */
  private async getAstridToken(): Promise<string | null> {
    const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
    const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      return null
    }

    try {
      const response = await fetch('https://astrid.cc/api/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      })

      if (!response.ok) return null

      const { access_token } = await response.json()
      return access_token
    } catch {
      return null
    }
  }

  /**
   * Check if a similar task already exists
   */
  private async findExistingTask(errorSummary: string): Promise<string | null> {
    const token = await this.getAstridToken()
    if (!token) return null

    try {
      const response = await fetch(
        `https://astrid.cc/api/v1/tasks?listId=${CONFIG.astridListId}&completed=false`,
        {
          headers: {
            'X-OAuth-Token': token,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) return null

      const data = await response.json()
      const tasks = data.tasks || []

      // Look for existing predeploy failure tasks
      const existing = tasks.find((task: any) =>
        task.title.includes('Predeploy') &&
        task.title.includes(errorSummary.slice(0, 30))
      )

      return existing?.id || null
    } catch {
      return null
    }
  }

  /**
   * Create an Astrid task for unfixable issues
   */
  private async createAstridTask(
    failedChecks: CheckResult[],
    fixAttempts: FixAttempt[]
  ): Promise<string | null> {
    if (!CONFIG.createTasks) {
      console.log('\n📝 Task creation disabled, skipping...')
      return null
    }

    const token = await this.getAstridToken()
    if (!token) {
      console.log('\n⚠️  Astrid OAuth not configured - cannot create task')
      console.log('   Set ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET')
      return null
    }

    const failedNames = failedChecks.map((c) => c.name).join(', ')
    const errorSummary = failedChecks[0]?.name || 'Unknown'

    // Check for existing task
    const existingTaskId = await this.findExistingTask(errorSummary)
    if (existingTaskId) {
      console.log(`\n📝 Found existing task for this issue: ${existingTaskId}`)
      await this.addTaskComment(existingTaskId, failedChecks, fixAttempts)
      return existingTaskId
    }

    const title = `🔴 Predeploy Failed: ${failedNames}`

    const description = `## Automated Predeploy Failure Report

**Generated**: ${new Date().toISOString()}
**Duration**: ${((Date.now() - this.startTime) / 1000).toFixed(1)}s

### Failed Checks

${failedChecks
  .map(
    (c) => `#### ❌ ${c.name}
- **Command**: \`${c.command}\`
- **Auto-fixable**: ${c.autoFixable ? 'Yes' : 'No'}
- **Duration**: ${(c.duration / 1000).toFixed(1)}s

**Output** (truncated):
\`\`\`
${c.output.slice(0, 1500)}${c.output.length > 1500 ? '\n... (truncated)' : ''}
\`\`\`
`
  )
  .join('\n')}

### Auto-Fix Attempts

${
  fixAttempts.length > 0
    ? fixAttempts
        .map(
          (f) =>
            `- **${f.check}**: ${f.success ? '✅ Fixed' : '❌ Failed'}\n  - Command: \`${f.fixCommand}\``
        )
        .join('\n')
    : '_No auto-fixes were attempted_'
}

### Action Items

- [ ] Investigate the failing check(s)
- [ ] Fix the root cause
- [ ] Run \`npm run predeploy:full\` to verify
- [ ] Commit and push fixes

---
*Created by Self-Healing Predeploy Script*`

    try {
      const response = await fetch('https://astrid.cc/api/v1/tasks', {
        method: 'POST',
        headers: {
          'X-OAuth-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          listId: CONFIG.astridListId,
          title,
          description,
          priority: 3, // High priority for build failures
        }),
      })

      if (!response.ok) {
        console.error(`\n❌ Failed to create Astrid task: ${response.status}`)
        return null
      }

      const data = await response.json()
      const taskId = data.task?.id || data.id

      console.log(`\n✅ Created Astrid task: ${taskId}`)
      console.log(`   View at: https://astrid.cc/task/${taskId}`)

      return taskId
    } catch (error) {
      console.error('\n❌ Error creating Astrid task:', error)
      return null
    }
  }

  /**
   * Add a comment to an existing task
   */
  private async addTaskComment(
    taskId: string,
    failedChecks: CheckResult[],
    fixAttempts: FixAttempt[]
  ): Promise<void> {
    const token = await this.getAstridToken()
    if (!token) return

    const comment = `## New Failure Occurrence

**Time**: ${new Date().toISOString()}

### Failed Checks
${failedChecks.map((c) => `- ❌ ${c.name}`).join('\n')}

### Fix Attempts
${fixAttempts.length > 0 ? fixAttempts.map((f) => `- ${f.check}: ${f.success ? '✅' : '❌'}`).join('\n') : '_None_'}

---
*Auto-generated by predeploy script*`

    try {
      await fetch(`https://astrid.cc/api/v1/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: {
          'X-OAuth-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: comment,
          type: 'TEXT',
        }),
      })
      console.log(`   Added comment to existing task`)
    } catch {
      // Ignore comment errors
    }
  }

  /**
   * Mark a task as resolved
   */
  async resolveTask(taskId: string): Promise<void> {
    const token = await this.getAstridToken()
    if (!token) return

    const comment = `## ✅ Issue Resolved

All predeploy checks are now passing.

**Resolved at**: ${new Date().toISOString()}

---
*Auto-resolved by predeploy script*`

    try {
      // Add resolution comment
      await fetch(`https://astrid.cc/api/v1/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: {
          'X-OAuth-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: comment,
          type: 'TEXT',
        }),
      })

      // Mark as complete
      await fetch(`https://astrid.cc/api/v1/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'X-OAuth-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ completed: true }),
      })

      console.log(`\n✅ Resolved Astrid task: ${taskId}`)
    } catch {
      // Ignore resolution errors
    }
  }

  /**
   * Print summary report
   */
  private printSummary(): void {
    const totalDuration = Date.now() - this.startTime
    const passed = this.results.filter((r) => r.passed)
    const failed = this.results.filter((r) => !r.passed)

    console.log('\n' + '═'.repeat(60))
    console.log('📋 PREDEPLOY SUMMARY')
    console.log('═'.repeat(60))

    console.log(`\n⏱️  Total Duration: ${(totalDuration / 1000).toFixed(1)}s`)
    console.log(`✅ Passed: ${passed.length}/${this.results.length}`)
    console.log(`❌ Failed: ${failed.length}/${this.results.length}`)

    if (this.fixAttempts.length > 0) {
      const successfulFixes = this.fixAttempts.filter((f) => f.success)
      console.log(`🔧 Auto-fixes: ${successfulFixes.length}/${this.fixAttempts.length} successful`)
    }

    // Show test statistics for all test checks
    const checksWithStats = this.results.filter((r) => r.testStats)
    if (checksWithStats.length > 0) {
      console.log('\n📊 Test Results:')
      checksWithStats.forEach((r) => {
        const stats = r.testStats!
        const icon = r.passed ? '✅' : '❌'
        console.log(`   ${icon} ${r.name}: ${this.formatTestStats(stats)}`)
      })

      // Show totals if multiple test suites
      if (checksWithStats.length > 1) {
        const totals = checksWithStats.reduce(
          (acc, r) => {
            acc.passed += r.testStats!.passed
            acc.failed += r.testStats!.failed
            acc.skipped += r.testStats!.skipped
            acc.total += r.testStats!.total
            return acc
          },
          { passed: 0, failed: 0, skipped: 0, total: 0 }
        )
        console.log(`   ─────────────────────────────────`)
        console.log(`   📈 Total: ${this.formatTestStats(totals)}`)
      }
    }

    if (failed.length > 0) {
      console.log('\n❌ Failed Checks:')
      failed.forEach((r) => {
        let line = `   - ${r.name}${r.autoFixable ? ' (auto-fixable)' : ''}`
        if (r.testStats && r.testStats.failed > 0) {
          line += ` [${r.testStats.failed} test failures]`
        }
        console.log(line)
      })
    }

    console.log('\n' + '═'.repeat(60))

    if (failed.length === 0) {
      console.log('🎉 ALL CHECKS PASSED - Ready to deploy!')
    } else {
      console.log('🚫 PREDEPLOY FAILED - Fix issues before deploying')
    }

    console.log('═'.repeat(60) + '\n')
  }

  /**
   * Main execution loop with self-healing
   */
  async run(options: { dryRun?: boolean; ci?: boolean } = {}): Promise<boolean> {
    console.log('🚀 Self-Healing Predeploy Starting...')
    console.log(`   Max retries: ${CONFIG.maxRetries}`)
    console.log(`   Create tasks: ${CONFIG.createTasks}`)
    if (options.dryRun) console.log('   Mode: DRY RUN (no fixes)')
    if (options.ci) console.log('   Mode: CI (strict)')

    const checks = this.getChecks()
    let failedChecks: CheckResult[] = []
    let allPassedResults: CheckResult[] = [] // Keep track of all passed results

    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
      console.log(`\n${'─'.repeat(40)}`)
      console.log(`📍 Attempt ${attempt}/${CONFIG.maxRetries}`)
      console.log('─'.repeat(40))

      // Run all checks (or just previously failed ones on retry)
      const checksToRun = attempt === 1 ? checks : checks.filter((c) =>
        failedChecks.some((f) => f.name === c.name)
      )

      const currentResults: CheckResult[] = []
      for (const check of checksToRun) {
        const result = this.runCheck(check)
        currentResults.push(result)
      }

      // Collect passed results from this attempt
      const newlyPassed = currentResults.filter((r) => r.passed)
      allPassedResults = [
        ...allPassedResults.filter((r) => !checksToRun.some((c) => c.name === r.name)),
        ...newlyPassed,
      ]

      // Build complete results list (all passed + current failed)
      failedChecks = currentResults.filter((r) => !r.passed)
      this.results = [...allPassedResults, ...failedChecks]

      if (failedChecks.length === 0) {
        console.log('\n✅ All checks passed!')
        break
      }

      // Attempt auto-fixes if not dry run and not last attempt
      if (!options.dryRun && attempt < CONFIG.maxRetries) {
        const fixableChecks = failedChecks.filter((r) => r.autoFixable && r.fixCommand)

        if (fixableChecks.length > 0) {
          console.log(`\n🔧 Attempting ${fixableChecks.length} auto-fix(es)...`)

          for (const check of fixableChecks) {
            const fixResult = this.attemptFix(check)
            this.fixAttempts.push(fixResult)
          }
        } else {
          console.log('\n⚠️  No auto-fixable checks found')
          break // Exit loop early if nothing can be fixed
        }
      }
    }

    this.printSummary()

    // Create/update Astrid task if still failing
    if (failedChecks.length > 0 && (options.ci || CONFIG.createTasks)) {
      await this.createAstridTask(failedChecks, this.fixAttempts)
    }

    // Exit with error code in CI mode
    if (options.ci && failedChecks.length > 0) {
      process.exit(1)
    }

    return failedChecks.length === 0
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry') || args.includes('-d')
  const ci = args.includes('--ci')

  const predeploy = new SelfHealingPredeploy()
  const success = await predeploy.run({ dryRun, ci })

  if (!success && !ci) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

export { SelfHealingPredeploy, CONFIG }
