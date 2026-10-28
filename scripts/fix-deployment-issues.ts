#!/usr/bin/env tsx

/**
 * Deployment Issues Fix Script
 * 
 * This script automatically fixes common deployment issues
 * to prevent build failures.
 * 
 * Run with: npm run fix:deployment
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'

console.log('🔧 Fixing Common Deployment Issues\n')

// Fix 1: Add dynamic export to API routes that use headers
function fixApiRoutes() {
  console.log('📡 Checking API routes for dynamic server usage...')
  
  const apiRoutes = [
    'app/api/account/route.ts',
    'app/api/users/search/route.ts',
    'app/api/invitations/route.ts',
    'app/api/invitations/[token]/route.ts',
    'app/api/tasks/route.ts',
    'app/api/lists/route.ts'
  ]

  let fixed = 0

  apiRoutes.forEach(routePath => {
    if (existsSync(routePath)) {
      const content = readFileSync(routePath, 'utf-8')
      
      // Check if it already has dynamic export
      if (!content.includes('export const dynamic') && !content.includes('export const runtime')) {
        // Add dynamic export after imports
        const lines = content.split('\n')
        let insertIndex = 0
        
        // Find the last import statement
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('import ') || lines[i].startsWith('import{')) {
            insertIndex = i + 1
          }
        }
        
        // Insert the exports
        lines.splice(insertIndex, 0, '', 'export const runtime = \'nodejs\'', 'export const dynamic = \'force-dynamic\'')
        
        writeFileSync(routePath, lines.join('\n'))
        console.log(`  ✅ Fixed: ${routePath}`)
        fixed++
      }
    }
  })

  console.log(`   Fixed ${fixed} API routes\n`)
}

// Fix 2: Add Suspense boundaries for useSearchParams
function fixSuspenseBoundaries() {
  console.log('⏳ Checking pages for useSearchParams without Suspense...')
  
  const pagesWithSearchParams = [
    'app/auth/verify-email/page.tsx',
    'app/settings/page.tsx',
    'app/invite/[token]/page.tsx'
  ]

  let fixed = 0

  pagesWithSearchParams.forEach(pagePath => {
    if (existsSync(pagePath)) {
      const content = readFileSync(pagePath, 'utf-8')
      
      // Check if it uses useSearchParams but doesn't have Suspense
      if (content.includes('useSearchParams') && !content.includes('Suspense')) {
        console.log(`  ⚠️  ${pagePath} needs Suspense boundary fix`)
        console.log(`     Please manually wrap the component using useSearchParams in <Suspense>`)
        // Note: This is complex to auto-fix, so we just warn
      }
    }
  })

  console.log(`   Checked ${pagesWithSearchParams.length} pages\n`)
}

// Fix 3: Update Next.js config for proper static export handling
function fixNextConfig() {
  console.log('⚙️  Checking Next.js configuration...')
  
  const configPath = 'next.config.mjs'
  
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, 'utf-8')
    
    // Check if it has proper configuration for Vercel deployment
    if (!content.includes('output:') && !content.includes('experimental:')) {
      console.log(`  ✅ Next.js config looks good`)
    }
  } else {
    // Create a basic Next.js config
    const defaultConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma']
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
}

export default nextConfig
`
    writeFileSync(configPath, defaultConfig)
    console.log(`  ✅ Created basic Next.js config`)
  }
  
  console.log('')
}

// Fix 4: Clean up build artifacts
function cleanBuildArtifacts() {
  console.log('🧹 Cleaning build artifacts...')
  
  try {
    execSync('rm -rf .next', { stdio: 'pipe' })
    console.log('  ✅ Removed .next directory')
  } catch (error) {
    console.log('  ℹ️  No .next directory to remove')
  }
  
  try {
    execSync('rm -rf dist', { stdio: 'pipe' })
    console.log('  ✅ Removed dist directory')
  } catch (error) {
    console.log('  ℹ️  No dist directory to remove')
  }
  
  console.log('')
}

// Fix 5: Regenerate Prisma client
function fixPrismaClient() {
  console.log('🗄️  Regenerating Prisma client...')
  
  try {
    execSync('npx prisma generate', { stdio: 'pipe' })
    console.log('  ✅ Prisma client regenerated')
  } catch (error) {
    console.log('  ❌ Failed to regenerate Prisma client')
    console.log(`     ${error}`)
  }
  
  console.log('')
}

// Fix 6: Check environment variables
function checkEnvironmentVariables() {
  console.log('🌍 Checking environment variables...')
  
  const requiredVars = [
    'NEXTAUTH_SECRET',
    'NEXTAUTH_URL', 
    'DATABASE_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET'
  ]
  
  const missing = requiredVars.filter(varName => !process.env[varName])
  
  if (missing.length > 0) {
    console.log('  ⚠️  Missing required environment variables:')
    missing.forEach(varName => console.log(`     - ${varName}`))
    console.log('     Make sure these are set in your Vercel dashboard')
  } else {
    console.log('  ✅ All required environment variables are set')
  }
  
  console.log('')
}

// Main execution
async function main() {
  console.log('Starting deployment fixes...\n')
  
  fixApiRoutes()
  fixSuspenseBoundaries()
  fixNextConfig()
  cleanBuildArtifacts()
  fixPrismaClient()
  checkEnvironmentVariables()
  
  console.log('🎉 Deployment fixes completed!')
  console.log('\nNext steps:')
  console.log('1. Run "npm run predeploy:check" to validate fixes')
  console.log('2. Commit and push your changes')
  console.log('3. Deploy to Vercel')
  console.log('')
}

main().catch(console.error)
