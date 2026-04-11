/**
 * Check if server environment variables are loaded
 */

console.log('🔍 Server Environment Check:')
console.log('================================')

console.log('NODE_ENV:', process.env.NODE_ENV)
console.log('NEXTAUTH_URL:', process.env.NEXTAUTH_URL)
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL)
console.log('ENCRYPTION_KEY exists:', !!process.env.ENCRYPTION_KEY)

if (process.env.ENCRYPTION_KEY) {
  console.log('ENCRYPTION_KEY length:', process.env.ENCRYPTION_KEY.length)
  console.log('ENCRYPTION_KEY preview:', process.env.ENCRYPTION_KEY.substring(0, 8) + '...')
} else {
  console.log('❌ ENCRYPTION_KEY is not set!')
  console.log('📁 Checking .env.local file...')

  try {
    const fs = require('fs')
    const path = require('path')
    const envPath = path.join(process.cwd(), '.env.local')

    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8')
      const hasEncryptionKey = envContent.includes('ENCRYPTION_KEY=')
      console.log('✅ .env.local exists')
      console.log('Has ENCRYPTION_KEY line:', hasEncryptionKey)

      if (hasEncryptionKey) {
        console.log('💡 Key is in .env.local but not loaded. Try restarting the server.')
      }
    } else {
      console.log('❌ .env.local file not found')
    }
  } catch (error) {
    console.log('Error checking .env.local:', error.message)
  }
}

// Test if we're in a server context
console.log('\n🌐 Environment Context:')
console.log('typeof window:', typeof window)
console.log('Is server side:', typeof window === 'undefined')

console.log('\n📝 All environment variables with ENCRYPTION:')
Object.keys(process.env)
  .filter(key => key.includes('ENCRYPTION'))
  .forEach(key => {
    console.log(`${key}:`, process.env[key] ? 'SET' : 'NOT SET')
  })