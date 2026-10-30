#!/usr/bin/env tsx

/**
 * Production database migration script
 * This script applies database migrations to the production database
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { createScriptPrisma } from './lib/script-prisma'

async function main() {
  console.log('🚀 Starting production database migration...')
  
  try {
    // Read the production database URL from .env.local
    const envPath = path.join(process.cwd(), '.env.local')
    if (!fs.existsSync(envPath)) {
      throw new Error('.env.local file not found')
    }

    const envContent = fs.readFileSync(envPath, 'utf8')
    const prodUrlMatch = envContent.match(/DATABASE_URL_PROD\s*=\s*(.+)/)
    
    if (!prodUrlMatch) {
      throw new Error('DATABASE_URL_PROD not found in .env.local')
    }

    const prodDbUrl = prodUrlMatch[1].replace(/^["']|["']$/g, '') // Remove quotes if present
    console.log('📦 Found production database URL')

    // Temporarily set the DATABASE_URL to production for migration
    process.env.DATABASE_URL = prodDbUrl

    // 1. Generate Prisma client with production DB
    console.log('⚙️  Generating Prisma client...')
    execSync('npx prisma generate', { 
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: prodDbUrl }
    })

    // 2. Check if we can connect to the database
    console.log('🔗 Testing database connection...')
    const probe = createScriptPrisma({ url: prodDbUrl })
    try {
      await probe.$connect()
      console.log('✅ Connected to production database')
    } catch (e) {
      throw new Error(`Connection failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await probe.$disconnect()
    }

    // 3. Deploy migrations to production
    console.log('📊 Deploying database migrations to production...')
    execSync('npx prisma migrate deploy', { 
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: prodDbUrl }
    })

    // 4. Apply the new performance indexes using db push
    console.log('⚡ Applying performance optimizations (indexes)...')
    execSync('npx prisma db push', { 
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: prodDbUrl }
    })

    // 5. Run database optimization checks
    console.log('🔧 Running database optimization checks...')
    try {
      execSync('npm run db:optimize', {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: prodDbUrl }
      })
    } catch (error) {
      console.warn('⚠️  Database optimization checks failed, but migration succeeded')
    }

    console.log('✅ Production database migration completed successfully!')
    console.log('📋 Next steps:')
    console.log('   1. Deploy to Vercel with: vercel --prod')
    console.log('   2. Set DATABASE_URL in Vercel dashboard to your production URL')
    console.log('   3. Set other required environment variables')

  } catch (error) {
    console.error('❌ Production migration failed:', error)
    process.exit(1)
  }
}

// Run the migration if called directly
if (require.main === module) {
  main().catch(console.error)
}

export { main as migrateProduction }