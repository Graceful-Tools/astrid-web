import { PrismaClient } from '@prisma/client'
import { GitHubClient } from '../lib/github-client'

const prisma = new PrismaClient()

async function testSimpleCodingWorkflow() {
  console.log('\n🧪 Testing Simple Coding Workflow Locally\n')

  try {
    // Test data - uses production database with your GitHub integration
    const repository = 'jonparis/astrid-res-www'
    const userId = process.env.TEST_USER_ID || 'cmeje966q0000k1045si7zrz3' // jonparis@gmail.com
    
    console.log(`1️⃣ Testing with user: ${userId}`)
    console.log(`   Repository: ${repository}\n`)

    // Step 1: Create GitHub client
    console.log('2️⃣ Creating GitHub client...')
    const githubClient = await GitHubClient.forUser(userId)
    console.log('   ✅ GitHub client created\n')

    // Step 2: Test reading a file (we know this works)
    console.log('3️⃣ Testing file read...')
    const readmeContent = await githubClient.getFile(repository, 'README.md')
    console.log(`   ✅ Read file: ${readmeContent.substring(0, 50)}...\n`)

    // Step 3: Create a test branch
    const branchName = `test-simple-workflow-${Date.now()}`
    console.log(`4️⃣ Creating branch: ${branchName}...`)
    await githubClient.createBranch(repository, 'main', branchName)
    console.log('   ✅ Branch created\n')

    // Step 4: Commit a simple file
    console.log('5️⃣ Committing test file...')
    const commitResult = await githubClient.commitChanges(
      repository,
      branchName,
      [
        {
          path: 'test-workflow.md',
          content: '# Test Workflow\n\nThis file was created by the automated coding workflow test.',
          mode: 'create',
          encoding: 'utf-8'
        }
      ],
      'test: add test-workflow.md via automated workflow'
    )
    console.log(`   ✅ Commit created: ${commitResult.sha}\n`)

    // Step 5: Create pull request
    console.log('6️⃣ Creating pull request...')
    const pr = await githubClient.createPullRequest(
      repository,
      'Test: Simple Coding Workflow',
      '## Automated Test\n\nThis PR was created by testing the simple coding workflow.\n\n✅ Branch created\n✅ File committed\n✅ PR created\n\nYou can safely close this PR - it was just a test!',
      branchName,
      'main'
    )
    console.log(`   ✅ Pull request created: #${pr.number}`)
    console.log(`   URL: ${pr.url}\n`)

    console.log('🎉 SUCCESS! All GitHub operations working correctly!\n')
    console.log(`📝 Next steps:`)
    console.log(`   1. Check the PR: ${pr.url}`)
    console.log(`   2. Close the PR if it looks good`)
    console.log(`   3. Delete the test branch: ${branchName}`)

  } catch (error) {
    console.error('\n❌ Error:', error)
    if (error instanceof Error) {
      console.error('   Message:', error.message)
      console.error('   Stack:', error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the test
testSimpleCodingWorkflow()
