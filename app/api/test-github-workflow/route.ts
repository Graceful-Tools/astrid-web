import { NextResponse } from 'next/server'
import { GitHubClient } from '@/lib/github-client'
import { createLogger } from '@/lib/logger'

const log = createLogger('test-github-workflow')


export async function POST(request: Request) {
  try {
    const { userId, repository } = await request.json()

    log.info('🧪 Testing GitHub workflow...')

    // Step 1: Create GitHub client
    const githubClient = await GitHubClient.forUser(userId)

    // Step 2: Test reading a file
    const readmeContent = await githubClient.getFile(repository, 'README.md')
    log.info(`✅ Read file: ${readmeContent.substring(0, 50)}...`)

    // Get repository info to find default branch
    const repoInfo = await githubClient.getRepository(repository)
    log.info(`✅ Repository: ${repoInfo.fullName}, default branch: ${repoInfo.defaultBranch}`)

    // Step 3: Create a test branch
    const branchName = `test-workflow-${Date.now()}`
    await githubClient.createBranch(repository, repoInfo.defaultBranch, branchName)
    log.info(`✅ Branch created: ${branchName}`)

    // Step 4: Commit a test file
    const commitResult = await githubClient.commitChanges(
      repository,
      branchName,
      [
        {
          path: 'test.md',
          content: 'test',
          mode: 'create',
          encoding: 'utf-8'
        }
      ],
      'test: add test.md via GitHub workflow test'
    )
    log.info(`✅ Commit created: ${commitResult.sha}`)

    // Step 5: Create pull request (correct parameter order: repo, head, base, title, body)
    const pr = await githubClient.createPullRequest(
      repository,
      branchName,
      repoInfo.defaultBranch,
      'Test: GitHub Workflow',
      `## Automated Test\n\nThis PR was created to test the GitHub workflow.\n\n✅ Branch: ${branchName}\n✅ Commit: ${commitResult.sha}\n\nYou can safely close this PR!`
    )

    return NextResponse.json({
      success: true,
      branchName,
      commitSha: commitResult.sha,
      prNumber: pr.number,
      prUrl: pr.url
    })

  } catch (error) {
    log.error({ err: error }, '❌ Test error:')
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
