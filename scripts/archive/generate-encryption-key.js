/**
 * Generate encryption key for API key storage
 */

const crypto = require('crypto')

function generateEncryptionKey() {
  // Generate a 32-byte (256-bit) random key
  const key = crypto.randomBytes(32).toString('hex')

  console.log('🔐 Generated new encryption key for API key storage:')
  console.log('')
  console.log('Add this to your .env.local file:')
  console.log('')
  console.log(`ENCRYPTION_KEY=${key}`)
  console.log('')
  console.log('⚠️  IMPORTANT: Keep this key secure! If you lose it, you\'ll need to re-enter all API keys.')
  console.log('⚠️  NEVER commit this key to version control.')
  console.log('')

  return key
}

if (require.main === module) {
  generateEncryptionKey()
}

module.exports = { generateEncryptionKey }