#!/usr/bin/env node
/**
 * Helper script to convert GitHub App private key to environment variable format
 */

const fs = require('fs')
const path = require('path')

console.log('🔑 GitHub App Private Key Setup')
console.log('================================')

// Check if private key file path is provided
const keyFilePath = process.argv[2]

if (!keyFilePath) {
  console.log('Usage: node scripts/setup-private-key.js <path-to-private-key.pem>')
  console.log('')
  console.log('Example:')
  console.log('  node scripts/setup-private-key.js ~/Downloads/astrid-code-assistant.2024-01-21.private-key.pem')
  console.log('')
  console.log('This will read your GitHub App private key file and format it for your .env.local')
  process.exit(1)
}

try {
  // Check if file exists
  if (!fs.existsSync(keyFilePath)) {
    console.error('❌ Private key file not found:', keyFilePath)
    console.log('')
    console.log('Make sure the file path is correct. Common locations:')
    console.log('  - ~/Downloads/astrid-code-assistant.*.private-key.pem')
    console.log('  - ./astrid-code-assistant.*.private-key.pem')
    process.exit(1)
  }

  // Read the private key file
  const privateKeyContent = fs.readFileSync(keyFilePath, 'utf8')

  // Validate it's a proper private key
  if (!privateKeyContent.includes('-----BEGIN RSA PRIVATE KEY-----') &&
      !privateKeyContent.includes('-----BEGIN PRIVATE KEY-----')) {
    console.error('❌ Invalid private key format. Expected PEM format with BEGIN PRIVATE KEY.')
    process.exit(1)
  }

  // Format for environment variable (escape newlines)
  const envPrivateKey = privateKeyContent.replace(/\n/g, '\\n')

  console.log('✅ Private key file found and validated')
  console.log('📋 Copy this value to your .env.local file:')
  console.log('')
  console.log('GITHUB_APP_PRIVATE_KEY="' + envPrivateKey + '"')
  console.log('')
  console.log('🔧 Steps to update:')
  console.log('1. Open .env.local in your editor')
  console.log('2. Replace the current GITHUB_APP_PRIVATE_KEY line with the one above')
  console.log('3. Save the file')
  console.log('4. Restart your development server')

} catch (error) {
  console.error('❌ Error reading private key file:', error.message)
  process.exit(1)
}