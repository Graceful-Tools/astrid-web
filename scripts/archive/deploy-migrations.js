#!/usr/bin/env node

/**
 * Automated migration deployment script for Vercel
 * Runs database migrations using production DATABASE_URL
 */

const { execSync } = require('child_process')

console.log('🚀 Starting automated migration deployment...')

try {
  // Ensure DATABASE_URL is set for production
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set')
    process.exit(1)
  }

  console.log('📋 Checking migration status...')
  
  // Check current migration status
  try {
    execSync('npx prisma migrate status', { stdio: 'inherit' })
  } catch (error) {
    console.log('⚠️  Migration status check failed, proceeding with deployment...')
  }

  console.log('🔄 Deploying migrations...')
  
  // Deploy migrations
  execSync('npx prisma migrate deploy', { stdio: 'inherit' })
  
  console.log('📦 Generating Prisma client...')
  
  // Generate Prisma client
  execSync('npx prisma generate', { stdio: 'inherit' })
  
  console.log('✅ Migration deployment completed successfully!')
  
} catch (error) {
  console.error('❌ Migration deployment failed:', error.message)
  process.exit(1)
}