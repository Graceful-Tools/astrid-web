#!/usr/bin/env tsx

/**
 * Vercel Log Monitor & Auto-Fix Script
 *
 * This script automatically monitors Vercel deployments, pulls logs from failed builds,
 * analyzes error patterns, and applies fixes to prevent recurring issues.
 *
 * Features:
 * - Monitors recent deployments for failures
 * - Pulls build logs from failed deployments
 * - Analyzes common error patterns
 * - Applies automatic fixes where possible
 * - Generates actionable reports
 * - Integrates with existing fix-deployment-issues.ts
 *
 * Usage:
 *   npm run monitor:vercel          # One-time check
 *   npm run monitor:vercel:watch    # Continuous monitoring
 */

import { execSync, spawn } from 'child_process'
import { brandOrigin } from '../lib/brand/config'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'
import {
  DEPLOY_MONITOR_TAG,
  deploymentFingerprint,
  isDeploymentMonitorTask,
  selectResolvableTasks,
} from './lib/deployment-monitor-tasks'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

interface VercelDeployment {
  id: string
  url: string
  status: string
  age: string
  environment: string
  duration: string
  username: string
}

interface ErrorPattern {
  pattern: RegExp
  description: string
  autoFix?: () => Promise<boolean>
  documentation?: string
}

class VercelLogMonitor {
  private logDir = path.join(process.cwd(), 'logs', 'vercel')
  private astridListId = 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba' // Astrid Bugs & Polish list

  constructor() {
    // Ensure logs directory exists
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
  }

  /**
   * Get OAuth access token for astrid.cc API
   */
  private async getAstridOAuthToken(): Promise<string | null> {
    const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
    const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      return null
    }

    try {
      const tokenResponse = await fetch('https://astrid.cc/api/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret
        })
      })

      if (!tokenResponse.ok) {
        return null
      }

      const { access_token } = await tokenResponse.json()
      return access_token
    } catch (error) {
      return null
    }
  }

  /**
   * Create a task in Astrid for deployment issues
   */
  async createAstridTask(title: string, description: string, priority: number = 2): Promise<string | null> {
    const token = await this.getAstridOAuthToken()
    if (!token) {
      console.error('❌ OAuth credentials not configured - cannot create Astrid task')
      return null
    }

    try {
      console.log(`📝 Creating Astrid task: "${title}"`)

      const response = await fetch('https://astrid.cc/api/v1/tasks', {
        method: 'POST',
        headers: {
          'X-OAuth-Token': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          // listIds (array), not listId. The singular field is silently
          // ignored, so every deployment-failure task this script filed landed
          // with NO list — findable only by id, and invisible on the board it
          // was meant to appear on (CLAUDE.md rule 5, task 1b381810).
          listIds: [this.astridListId],
          title,
          description,
          priority
        })
      })

      if (!response.ok) {
        console.error(`❌ Failed to create Astrid task: ${response.status}`)
        return null
      }

      const data = await response.json()
      const taskId = data.task?.id || data.id

      console.log(`✅ Created Astrid task (ID: ${taskId})`)
      return taskId

    } catch (error) {
      console.error('❌ Error creating Astrid task:', error)
      return null
    }
  }

  /**
   * Update an existing Astrid task
   */
  async updateAstridTask(taskId: string, updates: { title?: string; description?: string; completed?: boolean }): Promise<boolean> {
    const token = await this.getAstridOAuthToken()
    if (!token) {
      console.error('❌ OAuth credentials not configured - cannot update Astrid task')
      return false
    }

    try {
      console.log(`📝 Updating Astrid task: ${taskId}`)

      // PUT, not PATCH: app/api/v1/tasks/[id] exports GET, PUT and DELETE, so
      // every PATCH returned 405 and no completion ever landed. The route
      // applies only the fields present in the body — listIds is untouched when
      // absent — so a partial update is safe.
      //
      // ORDER MATTERS: this was fixed only alongside the filter tightening
      // above. On its own it would have converted a harmless 405 into silently
      // closing real bugs.
      const response = await fetch(`https://astrid.cc/api/v1/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'X-OAuth-Token': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      })

      if (!response.ok) {
        console.error(`❌ Failed to update Astrid task: ${response.status}`)
        return false
      }

      console.log(`✅ Updated Astrid task`)
      return true

    } catch (error) {
      console.error('❌ Error updating Astrid task:', error)
      return false
    }
  }

  /**
   * Add a comment to an Astrid task
   */
  async addAstridTaskComment(taskId: string, comment: string): Promise<boolean> {
    const token = await this.getAstridOAuthToken()
    if (!token) {
      console.error('❌ OAuth credentials not configured - cannot add comment')
      return false
    }

    try {
      console.log(`💬 Adding comment to Astrid task: ${taskId}`)

      const response = await fetch(`https://astrid.cc/api/v1/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: {
          'X-OAuth-Token': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: comment,
          type: 'TEXT'
        })
      })

      if (!response.ok) {
        console.error(`❌ Failed to add comment to Astrid task: ${response.status}`)
        return false
      }

      console.log(`✅ Added comment to Astrid task`)
      return true

    } catch (error) {
      console.error('❌ Error adding comment to Astrid task:', error)
      return false
    }
  }

  /**
   * Check if a deployment issue task already exists
   */
  async findExistingDeploymentTask(errorPattern: string): Promise<string | null> {
    const token = await this.getAstridOAuthToken()
    if (!token) return null

    try {
      const response = await fetch(`${brandOrigin()}/api/v1/tasks?listId=${this.astridListId}&completed=false`, {
        method: 'GET',
        headers: {
          'X-OAuth-Token': token,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) return null

      const data = await response.json()
      const tasks = data.tasks || []

      // Look for existing deployment tasks with similar error patterns
      // Same tightening as resolveDeploymentTasks: identify our own tasks by
      // the marker, not by common words. Less dangerous here because it is
      // ANDed with an error-pattern match and only leads to an update rather
      // than a completion — but it is the same mistake, so it goes too.
      const existingTask = tasks.find((task: any) =>
        !task.completed &&
        isDeploymentMonitorTask(task) &&
        (task.title.toLowerCase().includes(errorPattern.toLowerCase()) ||
         task.description?.toLowerCase().includes(errorPattern.toLowerCase()))
      )

      return existingTask ? existingTask.id : null

    } catch (error) {
      return null
    }
  }

  /**
   * Get recent deployments from Vercel
   */
  /**
   * Recent deployments, or NULL when Vercel could not be reached.
   *
   * Null rather than `[]` because the two mean opposite things and this method
   * used to conflate them (task aee6ce0d): a missing CLI, an expired token or a
   * Vercel outage all returned an empty array, which monitor() read as "nothing
   * failed" and acted on by closing the tasks tracking a real failure.
   */
  async getRecentDeployments(): Promise<VercelDeployment[] | null> {
    console.log('📡 Fetching recent Vercel deployments...')

    try {
      // Get deployment list - use --token if VERCEL_TOKEN is set (for CI)
      const tokenFlag = process.env.VERCEL_TOKEN ? `--token=${process.env.VERCEL_TOKEN}` : ''
      const output = execSync(`vercel list ${tokenFlag} --yes`, { encoding: 'utf-8', timeout: 30000 })
      const deployments: VercelDeployment[] = []

      // Parse the detailed table output
      const detailsLines = output.split('\n')
      let inDeploymentSection = false

      for (const line of detailsLines) {
        // Skip header lines until we reach the deployments table
        if (line.includes('Age') && line.includes('Status')) {
          inDeploymentSection = true
          continue
        }

        if (inDeploymentSection && line.trim() && !line.startsWith('>') && !line.includes('To display the next page') && !line.includes('Deployments for')) {
          // Parse each deployment line more carefully
          const trimmedLine = line.trim()

          // Extract URL first
          const urlMatch = trimmedLine.match(/https:\/\/[^\s]+/)
          if (urlMatch) {
            const url = urlMatch[0]

            // Parse the rest of the line by splitting on whitespace
            const parts = trimmedLine.split(/\s+/)

            // Find the status (contains ● symbol)
            let status = 'Unknown'
            for (const part of parts) {
              if (part.includes('●')) {
                status = part.replace(/[●•]/g, '').trim()
                break
              }
            }

            deployments.push({
              id: this.extractDeploymentId(url),
              url,
              age: parts[0] || 'Unknown',
              status,
              environment: parts.find(p => p === 'Production' || p === 'Preview') || 'Unknown',
              duration: parts.find(p => p.includes('s') || p.includes('m')) || 'Unknown',
              username: parts[parts.length - 1] || 'Unknown'
            })
          }
        }
      }

      console.log(`Found ${deployments.length} recent deployments`)
      const errorCount = deployments.filter(d => d.status === 'Error').length
      const readyCount = deployments.filter(d => d.status === 'Ready').length
      console.log(`  - ${errorCount} failed, ${readyCount} successful`)

      return deployments
    } catch (error) {
      console.error('❌ Failed to fetch deployments:', error)
      // NOT `[]`. An unfetchable list is not an empty one.
      return null
    }
  }

  /**
   * Extract deployment ID from URL
   */
  private extractDeploymentId(url: string): string {
    const match = url.match(/https:\/\/([^-]+)-/)
    return match ? match[1] : url
  }

  /**
   * Get build logs for a failed deployment
   */
  async getBuildLogs(deployment: VercelDeployment): Promise<string | null> {
    console.log(`📋 Getting logs for deployment: ${deployment.url}`)

    try {
      // For failed deployments, we can't get runtime logs but we can inspect build details
      const tokenFlag = process.env.VERCEL_TOKEN ? `--token=${process.env.VERCEL_TOKEN}` : ''
      const output = execSync(`vercel inspect ${deployment.url} ${tokenFlag} --yes`, {
        encoding: 'utf-8',
        timeout: 30000
      })

      // Save the inspection output
      const logFile = path.join(this.logDir, `${deployment.id}-inspect.txt`)
      writeFileSync(logFile, output)

      return output
    } catch (error) {
      console.error(`❌ Failed to get logs for ${deployment.url}:`, error)
      return null
    }
  }

  /**
   * Define common error patterns and their fixes
   */
  private getErrorPatterns(): ErrorPattern[] {
    return [
      {
        pattern: /Error: Deployment not ready\. Currently: ● Error/,
        description: 'Build failed during compilation',
        autoFix: async () => {
          console.log('🔧 Applying build failure fixes...')
          try {
            execSync('npm run fix:deployment', { stdio: 'inherit' })
            return true
          } catch {
            return false
          }
        },
        documentation: 'Build failed - likely TypeScript/lint errors or missing dependencies'
      },
      {
        pattern: /at \/vercel\/path0\/node_modules\/next\/dist\/server\/lib\/trace\/tracer\.js/,
        description: 'Next.js server tracer error',
        autoFix: async () => {
          console.log('🔧 Fixing Next.js tracer issues...')
          try {
            // Clear build cache and regenerate
            execSync('rm -rf .next && npm run predeploy:quick', { stdio: 'inherit' })
            return true
          } catch {
            return false
          }
        },
        documentation: 'Next.js internal error - usually fixed by clearing build cache'
      },
      {
        pattern: /Module not found/,
        description: 'Missing module or incorrect import path',
        autoFix: async () => {
          console.log('🔧 Checking for missing dependencies...')
          try {
            execSync('npm install', { stdio: 'inherit' })
            execSync('npm run db:generate', { stdio: 'inherit' })
            return true
          } catch {
            return false
          }
        },
        documentation: 'Missing module - check import paths and package.json dependencies'
      },
      {
        pattern: /TypeError.*Cannot read prop/,
        description: 'Runtime TypeError - likely undefined object access',
        documentation: 'Check for undefined object property access in the code'
      },
      {
        pattern: /PrismaClientKnownRequestError/,
        description: 'Prisma database connection or query error',
        autoFix: async () => {
          console.log('🔧 Regenerating Prisma client...')
          try {
            execSync('npm run db:generate', { stdio: 'inherit' })
            return true
          } catch {
            return false
          }
        },
        documentation: 'Prisma error - check database connection and schema'
      },
      {
        pattern: /ENOTFOUND.*vercel\.app/,
        description: 'Network connectivity issue with Vercel services',
        documentation: 'Temporary network issue - try redeploying'
      },
      {
        pattern: /Build exceeded maximum duration/,
        description: 'Build timeout - optimize build process',
        autoFix: async () => {
          console.log('🔧 Optimizing build process...')
          try {
            // Add build optimizations to next.config.mjs
            this.optimizeBuildConfig()
            return true
          } catch {
            return false
          }
        },
        documentation: 'Build took too long - optimize build process or upgrade Vercel plan'
      }
    ]
  }

  /**
   * Optimize build configuration
   */
  private optimizeBuildConfig() {
    const configPath = 'next.config.mjs'
    const optimizedConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma'],
    optimizeCss: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  swcMinify: true,
  images: {
    unoptimized: true
  },
  // Optimize bundling
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    if (!dev && !isServer) {
      config.optimization.splitChunks.chunks = 'all'
    }
    return config
  },
}

export default nextConfig
`
    writeFileSync(configPath, optimizedConfig)
    console.log('  ✅ Optimized Next.js config for faster builds')
  }

  /**
   * Analyze logs for error patterns
   */
  analyzeErrors(logs: string): { pattern: ErrorPattern; matches: string[] }[] {
    const findings: { pattern: ErrorPattern; matches: string[] }[] = []
    const patterns = this.getErrorPatterns()

    for (const pattern of patterns) {
      const matches = logs.match(pattern.pattern)
      if (matches) {
        findings.push({
          pattern,
          matches: Array.from(matches)
        })
      }
    }

    return findings
  }

  /**
   * Generate a comprehensive error report
   */
  generateReport(deployments: VercelDeployment[], analyses: Map<string, any[]>): string {
    const timestamp = new Date().toISOString()
    let report = `# Vercel Deployment Analysis Report
Generated: ${timestamp}

## Summary
- Total deployments analyzed: ${deployments.length}
- Failed deployments: ${deployments.filter(d => d.status === 'Error').length}
- Successful deployments: ${deployments.filter(d => d.status === 'Ready').length}

## Failed Deployments Analysis

`

    const failedDeployments = deployments.filter(d => d.status === 'Error')

    for (const deployment of failedDeployments) {
      report += `### Deployment: ${deployment.url}
- Age: ${deployment.age}
- Environment: ${deployment.environment}
- Duration: ${deployment.duration}

`

      const analysis = analyses.get(deployment.id) || []
      if (analysis.length > 0) {
        report += `**Detected Issues:**\n`
        for (const finding of analysis) {
          report += `- **${finding.pattern.description}**\n`
          report += `  - Pattern: \`${finding.pattern.pattern.source}\`\n`
          if (finding.pattern.documentation) {
            report += `  - Solution: ${finding.pattern.documentation}\n`
          }
          if (finding.pattern.autoFix) {
            report += `  - Auto-fix: Available\n`
          }
          report += `\n`
        }
      } else {
        report += `**No specific error patterns detected** - manual investigation required.\n\n`
      }
    }

    report += `## Recommendations

1. **Immediate Actions:**
   - Run \`npm run fix:deployment\` to apply common fixes
   - Check environment variables in Vercel dashboard
   - Verify database connectivity

2. **Prevention:**
   - Run \`npm run predeploy:essential\` before pushing
   - Set up automated monitoring with this script
   - Keep dependencies updated

3. **Monitoring:**
   - Schedule regular runs of this monitoring script
   - Set up alerts for deployment failures
   - Monitor build performance metrics

## Next Steps

\`\`\`bash
# Apply immediate fixes
npm run fix:deployment
npm run predeploy:essential

# Monitor continuously
npm run monitor:vercel:watch

# Check specific deployment
vercel logs <deployment-url>
\`\`\`

---
*Generated by Astrid Vercel Log Monitor*
`

    return report
  }

  /**
   * Mark deployment issue tasks as resolved when deployments are healthy
   */
  async resolveDeploymentTasks(): Promise<void> {
    const token = await this.getAstridOAuthToken()
    if (!token) {
      console.log('ℹ️  OAuth credentials not available - skipping task resolution')
      return
    }

    try {
      console.log('🔍 Checking for deployment issue tasks to resolve...')

      // Get tasks from the list
      const response = await fetch(`${brandOrigin()}/api/v1/tasks?listId=${this.astridListId}&completed=false`, {
        method: 'GET',
        headers: {
          'X-OAuth-Token': token,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        console.error(`❌ Failed to get tasks: ${response.status}`)
        return
      }

      const data = await response.json()
      const tasks = data.tasks || []

      // Find deployment failure tasks that are still open
      // Match the marker this script WRITES, never the words a human might
      // type (task d893debc). The old substring match on 'build' selected a
      // substantive open task about iOS adoption and commented on it.
      const deploymentTasks = selectResolvableTasks(tasks as any[])

      if (deploymentTasks.length === 0) {
        console.log('ℹ️  No deployment issue tasks found to resolve')
        return
      }

      console.log(`✅ Found ${deploymentTasks.length} deployment issue task(s) - marking as resolved due to healthy deployments`)

      for (const task of deploymentTasks) {
        // Add resolution comment
        const resolutionComment = `## ✅ Deployment Issues Resolved

All recent deployments are now successful. This deployment issue appears to be resolved.

**Resolution confirmed at**: ${new Date().toLocaleString()}
**Status**: No failed deployments detected in recent monitoring

The automated deployment monitoring system has confirmed that deployments are now stable.

---
*Automatically resolved by successful deployment monitoring*`

        await this.addAstridTaskComment(task.id, resolutionComment)

        // Mark task as completed
        const success = await this.updateAstridTask(task.id, { completed: true })

        if (success) {
          console.log(`✅ Resolved deployment task: "${task.title}" (${task.id})`)
        }
      }

    } catch (error) {
      console.error('❌ Error resolving deployment tasks:', error)
    }
  }

  /**
   * Main monitoring process
   */
  async monitor(applyFixes = true): Promise<void> {
    console.log('🚀 Starting Vercel deployment monitoring...\n')

    try {
      // Get recent deployments
      const deployments = await this.getRecentDeployments()

      // COULD NOT FETCH is not GOOD NEWS (task aee6ce0d). Saying nothing about
      // deployment health is the only honest outcome here, and the run has to
      // go red: this is on push-to-main and hourly cron, so a silent exit 0
      // means an expired token hides a real production failure indefinitely.
      if (deployments === null) {
        console.error('❌ Could not reach Vercel — not asserting deployment health')
        process.exitCode = 1
        return
      }

      const failedDeployments = deployments.filter(d => d.status === 'Error')

      if (failedDeployments.length === 0) {
        console.log('✅ No failed deployments found!')

        // Mark any existing deployment issue tasks as resolved since deployments
        // are healthy — but only when this run is allowed to change things.
        // `--no-fix` is an audit, and an audit must not comment on and complete
        // real tasks; it previously suppressed CODE fixes only.
        if (applyFixes) {
          await this.resolveDeploymentTasks()
        } else {
          console.log('ℹ️ --no-fix: leaving deployment issue tasks untouched')
        }
        return
      }

      console.log(`⚠️ Found ${failedDeployments.length} failed deployments`)

      // Analyze each failed deployment and create Astrid tasks
      const analyses = new Map()
      const createdTasks: string[] = []
      const updatedTasks: string[] = []

      for (const deployment of failedDeployments) {
        console.log(`\n📊 Analyzing deployment: ${deployment.url}`)

        const logs = await this.getBuildLogs(deployment)
        if (!logs) continue

        const findings = this.analyzeErrors(logs)
        analyses.set(deployment.id, findings)

        if (findings.length > 0) {
          console.log(`  Found ${findings.length} error pattern(s):`)

          for (const finding of findings) {
            console.log(`  - ${finding.pattern.description}`)

            // Check if a task for this error already exists
            const existingTaskId = await this.findExistingDeploymentTask(finding.pattern.description)

            if (existingTaskId) {
              console.log(`    📝 Updating existing Astrid task: ${existingTaskId}`)

              const updateComment = `## New Deployment Failure Detected

**Deployment**: ${deployment.url}
**Time**: ${new Date().toLocaleString()}
**Error**: ${finding.pattern.description}

**Details**:
${finding.pattern.documentation || 'Manual investigation required'}

${applyFixes && finding.pattern.autoFix ? '🔧 Auto-fix will be attempted' : ''}

**Raw Logs**:
\`\`\`
${logs.slice(0, 1000)}...
\`\`\``

              await this.addAstridTaskComment(existingTaskId, updateComment)
              updatedTasks.push(existingTaskId)
            } else {
              console.log(`    📝 Creating new Astrid task for: ${finding.pattern.description}`)

              const title = `🚨 Deployment Failure: ${finding.pattern.description}`

              // Machine-readable marker FIRST, so a later run can recognise
              // this task without guessing from its wording (task d893debc).
              const description = `${deploymentFingerprint(deployment.url)}

## Deployment Error Details

**First Detected**: ${new Date().toLocaleString()}
**Deployment**: ${deployment.url}
**Environment**: ${deployment.environment}
**Duration**: ${deployment.duration}

**Error Pattern**: ${finding.pattern.description}

**Solution**: ${finding.pattern.documentation || 'Manual investigation required'}

**Auto-fix Available**: ${finding.pattern.autoFix ? 'Yes ✅' : 'No ❌'}

## Recent Failure
**URL**: ${deployment.url}
**Age**: ${deployment.age}

**Raw Logs**:
\`\`\`
${logs.slice(0, 1500)}...
\`\`\`

## Action Items
- [ ] Investigate the root cause
- [ ] Apply the recommended solution
- [ ] Test the fix locally
- [ ] Deploy and verify resolution
- [ ] Update monitoring if needed

## Auto-Fix Status
${applyFixes && finding.pattern.autoFix ? '🔧 Auto-fix will be attempted by monitoring system' : '⚠️ Manual fix required'}

---
*Automatically created by Vercel Deployment Monitoring*`

              const priority = findings.length > 2 ? 3 : 2 // High priority if multiple issues
              const taskId = await this.createAstridTask(title, description, priority)

              if (taskId) {
                createdTasks.push(taskId)
              }
            }

            // Apply auto-fixes
            if (applyFixes && finding.pattern.autoFix) {
              console.log(`    🔧 Applying auto-fix...`)
              const fixed = await finding.pattern.autoFix()
              console.log(`    ${fixed ? '✅ Fix applied' : '❌ Fix failed'}`)

              // Add comment about fix status
              const fixComment = fixed
                ? `🔧 **Auto-fix Applied**: ${finding.pattern.description} fix has been applied successfully. Please test and verify the resolution.`
                : `❌ **Auto-fix Failed**: Attempted to apply fix for ${finding.pattern.description} but it failed. Manual intervention required.`

              const taskId = existingTaskId || createdTasks[createdTasks.length - 1]
              if (taskId) {
                await this.addAstridTaskComment(taskId, fixComment)
              }
            }
          }
        } else {
          console.log(`  No specific error patterns detected`)

          // Create a general investigation task for unknown errors
          const title = `🔍 Unknown Deployment Failure`
          const description = `${deploymentFingerprint(deployment.url)}

## Unknown Deployment Error

**Detected**: ${new Date().toLocaleString()}
**Deployment**: ${deployment.url}
**Environment**: ${deployment.environment}
**Duration**: ${deployment.duration}

**Status**: No specific error patterns detected - manual investigation required.

**Raw Logs**:
\`\`\`
${logs.slice(0, 2000)}...
\`\`\`

## Action Items
- [ ] Investigate the deployment logs
- [ ] Identify the root cause
- [ ] Add new error pattern to monitoring system
- [ ] Apply appropriate fix
- [ ] Test and verify resolution

---
*Automatically created by Vercel Deployment Monitoring*`

          const taskId = await this.createAstridTask(title, description, 2)
          if (taskId) {
            createdTasks.push(taskId)
          }
        }
      }

      // Generate and save report as before for logging
      const report = this.generateReport(deployments, analyses)
      const reportPath = path.join(this.logDir, `deployment-analysis-${Date.now()}.md`)
      writeFileSync(reportPath, report)

      console.log(`\n📊 Analysis complete! Report saved to: ${reportPath}`)
      console.log(`\n📋 Summary:`)
      console.log(`   - Failed deployments: ${failedDeployments.length}`)
      console.log(`   - Error patterns detected: ${Array.from(analyses.values()).flat().length}`)
      console.log(`   - Astrid tasks created: ${createdTasks.length}`)
      console.log(`   - Astrid tasks updated: ${updatedTasks.length}`)

      if (applyFixes) {
        console.log(`   - Auto-fixes applied where possible`)
        console.log(`\n🔄 Recommend running: npm run predeploy:essential`)
      }

      if (createdTasks.length > 0 || updatedTasks.length > 0) {
        console.log(`\n🎯 View tasks in Astrid: https://astrid.cc/list/${this.astridListId}`)
      }

    } catch (error) {
      console.error('❌ Monitoring failed:', error)
    }
  }

  /**
   * Watch mode - continuously monitor deployments
   */
  async watch(intervalMinutes = 10): Promise<void> {
    console.log(`🔄 Starting continuous monitoring (every ${intervalMinutes} minutes)...`)

    const runMonitoring = async () => {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`⏰ ${new Date().toLocaleString()} - Running deployment check...`)
      await this.monitor(true)
    }

    // Run immediately
    await runMonitoring()

    // Set up interval
    setInterval(runMonitoring, intervalMinutes * 60 * 1000)
  }
}

// CLI interface
async function main() {
  const monitor = new VercelLogMonitor()
  const args = process.argv.slice(2)

  if (args.includes('--watch') || args.includes('-w')) {
    const interval = parseInt(args.find(arg => arg.startsWith('--interval='))?.split('=')[1] || '10')
    await monitor.watch(interval)
  } else if (args.includes('--no-fix')) {
    await monitor.monitor(false)
  } else {
    await monitor.monitor(true)
  }
}

if (require.main === module) {
  main().catch(console.error)
}

export { VercelLogMonitor }