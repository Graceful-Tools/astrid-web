import { config } from 'dotenv'
import { GitHubClient } from '../lib/github-client'

config({ path: '.env.local' })

async function main() {
  console.log('\n🧪 Testing GitHub Client...\n')

  try {
    // Use production database to get real GitHub integration
    process.env.DATABASE_URL = process.env.DATABASE_URL_PROD

    const userId = 'cmeje966q0000k1045si7zrz3' // jonparis@gmail.com

    console.log(`Creating GitHub client for user: ${userId}`)
    const client = await GitHubClient.forUser(userId)

    console.log('\n✅ GitHub client created successfully!')
    console.log('\nAttempting to read README.md...')

    const content = await client.getFile('jonparis/astrid-res-www', 'README.md')

    console.log('\n✅ File read successfully!')
    console.log('\nFirst 200 characters:')
    console.log(content.substring(0, 200) + '...')

    // Get the 3rd word
    const words = content.split(/\s+/).filter(w => w.length > 0)
    console.log('\n📝 The 3rd word is:', words[2])

  } catch (error) {
    console.error('\n❌ Error:', error)
    if (error instanceof Error) {
      console.error('Stack:', error.stack)
    }
  }
}

main()
