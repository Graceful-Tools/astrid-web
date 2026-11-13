#!/usr/bin/env tsx
/**
 * Clean up a worktree after completing work
 *
 * Usage: npm run work:done <task-slug-or-id>
 * Example: npm run work:done "fix-search-clear"
 * Example: npm run work:done 123 (legacy)
 *
 * Actions:
 * - Removes worktree directory
 * - Deletes the branch locally and on origin once it is merged into origin/main
 *   (Jon, 2026-11-12: "Always remove branches post merge"); asks only when unmerged
 * - Database is SHARED and NOT dropped
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import readline from 'readline'

interface WorktreeInfo {
  taskSlug: string
  taskId?: string
  path: string
  branch: string
  port: number
  databaseUrl: string
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim().toLowerCase())
    })
  })
}

function isMergedIntoMain(branch: string): boolean {
  try {
    execSync('git fetch --prune --quiet origin', { stdio: 'pipe' })
    execSync(`git merge-base --is-ancestor ${branch} origin/main`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function existsOnOrigin(branch: string): boolean {
  try {
    execSync(`git ls-remote --exit-code --heads origin ${branch}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// Merged branches are always removed, locally and on origin. Unmerged ones ask first.
async function deleteBranch(branch: string) {
  console.log(`\n🌿 Branch: ${branch}`)
  if (!isMergedIntoMain(branch)) {
    const answer = await ask('Branch is NOT merged into origin/main. Delete it anyway? (yes/no): ')
    if (answer !== 'yes') {
      console.log(`ℹ️  Branch kept: ${branch}`)
      return
    }
  }
  try {
    execSync(`git branch -D ${branch}`, { stdio: 'pipe' })
    console.log(`✅ Local branch deleted`)
  } catch {
    console.error(`⚠️  Could not delete local branch`)
  }
  if (existsOnOrigin(branch)) {
    try {
      execSync(`git push --quiet origin --delete ${branch}`, { stdio: 'pipe' })
      console.log(`✅ origin/${branch} deleted`)
    } catch {
      console.error(`⚠️  Could not delete origin/${branch}`)
    }
  }
}

async function cleanupWorktree(taskIdentifier: string) {
  // Determine if identifier is numeric (legacy) or slug
  const isNumeric = /^\d+$/.test(taskIdentifier)
  const taskSlug = isNumeric ? taskIdentifier : taskIdentifier.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  console.log(`\n🧹 Cleaning up worktree for task: ${taskSlug}...`)

  const worktreePath = join(process.cwd(), '..', `www-task-${taskSlug}`)

  // Check if worktree exists
  if (!existsSync(worktreePath)) {
    console.error(`❌ Worktree not found at: ${worktreePath}`)
    process.exit(1)
  }

  // Load worktree info
  const infoPath = join(worktreePath, '.worktree-info.json')
  let info: WorktreeInfo | null = null

  if (existsSync(infoPath)) {
    info = JSON.parse(readFileSync(infoPath, 'utf-8'))
  }

  // Check for uncommitted changes
  try {
    const status = execSync('git status --porcelain', {
      cwd: worktreePath,
      encoding: 'utf-8'
    })

    // The worktree's own scaffolding files are not work.
    const changes = status
      .split('\n')
      .filter(line => line.trim() && !/\.worktree-(info\.json|context\.md)$/.test(line))
      .join('\n')

    if (changes) {
      console.log(`\n⚠️  Uncommitted changes detected:`)
      console.log(changes)
      const answer = await ask('Continue with cleanup? Changes will be lost! (yes/no): ')
      if (answer !== 'yes') {
        console.log('Cleanup cancelled.')
        process.exit(0)
      }
    }
  } catch (error) {
    // Ignore git status errors
  }

  // Remove worktree
  console.log(`📂 Removing worktree at: ${worktreePath}`)
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      stdio: 'inherit'
    })
    console.log(`✅ Worktree removed`)
  } catch (error) {
    console.error(`⚠️  Error removing worktree, trying manual cleanup...`)
    try {
      rmSync(worktreePath, { recursive: true, force: true })
      execSync(`git worktree prune`, { stdio: 'pipe' })
      console.log(`✅ Worktree manually removed`)
    } catch (err) {
      console.error(`❌ Failed to remove worktree: ${err}`)
    }
  }

  // Database is SHARED - do NOT drop
  if (info) {
    const dbName = info.databaseUrl.split('/').pop()
    console.log(`🗄️  Database: ${dbName} (SHARED - not dropped)`)
  }

  if (info) {
    await deleteBranch(info.branch)
  }

  console.log(`\n✨ Cleanup complete for task: ${taskSlug}!\n`)
}

// Main execution
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: npm run work:done <task-slug-or-id>')
  console.error('Example: npm run work:done "fix-search-clear"')
  console.error('Example: npm run work:done 123 (legacy)')
  process.exit(1)
}

const [taskIdentifier] = args

if (!taskIdentifier || taskIdentifier.trim() === '') {
  console.error('❌ Task identifier (slug or numeric ID) is required')
  process.exit(1)
}

cleanupWorktree(taskIdentifier).catch(error => {
  console.error(`❌ Error during cleanup: ${error}`)
  process.exit(1)
})
