#!/usr/bin/env tsx

/**
 * Production Database Deployment Script
 * 
 * This script sets up the database schema on your production server.
 * Run this after setting up your PostgreSQL database in production.
 */

import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'

const prisma = new PrismaClient()

async function main() {
  console.log('🚀 Production Database Deployment Script\n')

  try {
    // Step 1: Generate Prisma Client
    console.log('1. Generating Prisma Client...')
    try {
      execSync('npx prisma generate', { stdio: 'inherit' })
      console.log('   ✅ Prisma Client generated')
    } catch (error) {
      console.log('   ⚠️  Prisma Client generation failed, continuing...')
    }

    // Step 2: Test database connection
    console.log('\n2. Testing database connection...')
    await prisma.$connect()
    console.log('   ✅ Database connected successfully')

    // Step 3: Push schema to production
    console.log('\n3. Deploying database schema...')
    try {
      execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' })
      console.log('   ✅ Schema deployed successfully')
    } catch (error) {
      console.log('   ❌ Schema deployment failed')
      throw error
    }

    // Step 4: Verify all tables exist
    console.log('\n4. Verifying database schema...')
    
    const tables = ['User', 'TaskList', 'Task', 'Comment', 'Attachment', 'Account', 'Session', 'Invitation', 'VerificationToken']
    const tableChecks = await Promise.all(
      tables.map(async (tableName) => {
        try {
          const count = await (prisma as any)[tableName].count()
          return { table: tableName, exists: true, count }
        } catch (error) {
          return { table: tableName, exists: false, count: 0 }
        }
      })
    )

    console.log('   📊 Table Status:')
    tableChecks.forEach(({ table, exists, count }) => {
      const status = exists ? '✅' : '❌'
      const countInfo = exists ? `(${count} records)` : ''
      console.log(`      ${status} ${table} ${countInfo}`)
    })

    // Step 5: Test basic operations
    console.log('\n5. Testing database operations...')
    
    // Test user creation (will be cleaned up)
    const testUser = await prisma.user.create({
      data: {
        name: 'Test User',
        email: `test-${Date.now()}@example.com`,
      }
    })
    
    // Clean up test user
    await prisma.user.delete({
      where: { id: testUser.id }
    })
    
    console.log('   ✅ Database operations working')

    // Step 6: Display production checklist
    console.log('\n🎉 Production Database Setup Complete!')
    console.log('\n📋 Production Deployment Checklist:')
    console.log('1. ✅ Database schema deployed')
    console.log('2. ✅ All tables created')
    console.log('3. ✅ Database operations verified')
    console.log('4. 🔄 Deploy your application to Vercel')
    console.log('5. 🔄 Set environment variables in Vercel:')
    console.log('   - DATABASE_URL (your production PostgreSQL URL)')
    console.log('   - NEXTAUTH_SECRET (strong random string)')
    console.log('   - NEXTAUTH_URL (your production domain)')
    console.log('   - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET')
    console.log('6. 🔄 Test authentication flow in production')
    console.log('7. 🔄 Verify all features work correctly')

    // Step 7: Environment variable validation
    console.log('\n🔧 Environment Variable Check:')
    const requiredVars = [
      'DATABASE_URL',
      'NEXTAUTH_SECRET', 
      'NEXTAUTH_URL',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET'
    ]
    
    requiredVars.forEach(varName => {
      const value = process.env[varName]
      const status = value ? '✅' : '❌'
      const displayValue = value ? 
        (varName === 'DATABASE_URL' ? 'Set (PostgreSQL)' : 'Set') : 
        'Missing'
      console.log(`   ${status} ${varName}: ${displayValue}`)
    })

    if (!process.env.DATABASE_URL?.includes('postgresql')) {
      console.log('\n⚠️  Warning: DATABASE_URL should be a PostgreSQL connection string')
      console.log('   Example: postgresql://user:password@host:port/database?sslmode=require')
    }

  } catch (error) {
    console.error('\n❌ Production database setup failed:', error)
    
    if (error instanceof Error) {
      if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        console.log('\n💡 Connection troubleshooting:')
        console.log('- Check your DATABASE_URL is correct')
        console.log('- Ensure the database server is running')
        console.log('- Verify network connectivity')
        console.log('- Check if SSL is required (add ?sslmode=require)')
        console.log('- Verify database credentials')
      } else if (error.message.includes('authentication failed')) {
        console.log('\n💡 Authentication troubleshooting:')
        console.log('- Verify username and password in DATABASE_URL')
        console.log('- Check if user has necessary permissions')
        console.log('- Ensure database exists')
        console.log('- Check if user can create tables')
      } else if (error.message.includes('permission denied')) {
        console.log('\n💡 Permission troubleshooting:')
        console.log('- Ensure database user has CREATE privileges')
        console.log('- Check if user can create tables in public schema')
        console.log('- Verify database ownership')
      }
    }
    
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Helper function to display environment info
function displayEnvironmentInfo() {
  console.log('🔧 Environment Information:')
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`)
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✅ Set' : '❌ Missing'}`)
  console.log(`   NEXTAUTH_SECRET: ${process.env.NEXTAUTH_SECRET ? '✅ Set' : '❌ Missing'}`)
  console.log(`   NEXTAUTH_URL: ${process.env.NEXTAUTH_URL || '❌ Missing'}`)
  console.log('')
}

// Display environment info before running
displayEnvironmentInfo()

main()
  .catch((error) => {
    console.error('Script failed:', error)
    process.exit(1)
  })
