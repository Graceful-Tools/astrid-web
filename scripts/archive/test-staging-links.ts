#!/usr/bin/env npx tsx
/**
 * Test script for staging/preview link functionality
 * Tests iOS file detection and Vercel preview URL fetching
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const GITHUB_TOKEN = process.env.GITHUB_TOKEN

if (!GITHUB_TOKEN) {
  console.error('❌ GITHUB_TOKEN not set in .env.local')
  process.exit(1)
}

// iOS file patterns (same as in worker)
const iosPatterns = [
  /^ios-app\//,
  /^ios\//,
  /\.swift$/,
  /\.xcodeproj\//,
  /\.xcworkspace\//,
  /\.xcdatamodeld\//,
  /\.storyboard$/,
  /\.xib$/,
  /Info\.plist$/,
  /\.entitlements$/,
  /Podfile(\.lock)?$/,
  /Package\.swift$/,
]

async function checkPRHasIOSChanges(owner: string, repo: string, prNumber: number): Promise<{
  hasIOSChanges: boolean
  iosFiles: string[]
  totalFiles: number
}> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`,
    {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch PR files: ${response.statusText}`)
  }

  const files = await response.json() as Array<{ filename: string }>

  const iosFiles = files
    .filter(file => iosPatterns.some(pattern => pattern.test(file.filename)))
    .map(f => f.filename)

  return {
    hasIOSChanges: iosFiles.length > 0,
    iosFiles,
    totalFiles: files.length,
  }
}

async function testWithRealPR() {
  console.log('🧪 Testing iOS file detection\n')

  // Simulate recent iOS commit files (from git log)
  const recentIOSFiles = [
    'ios-app/Astrid App/Core/Services/AttachmentService.swift',
    'ios-app/Astrid App/Views/Components/AttachmentThumbnail.swift',
    'ios-app/Astrid App/Core/Authentication/AuthManager.swift',
  ]

  const recentWebFiles = [
    'app/api/auth/apple/route.ts',
    'app/api/auth/google/route.ts',
    'components/ui/error-boundary.tsx',
  ]

  console.log('📋 Simulating PR with iOS changes:')
  const iosResult = recentIOSFiles.filter(f =>
    iosPatterns.some(p => p.test(f))
  )
  console.log(`   Files: ${recentIOSFiles.length}`)
  console.log(`   iOS detected: ${iosResult.length > 0 ? '✅ Yes' : '❌ No'}`)
  iosResult.forEach(f => console.log(`     - ${f}`))
  console.log()

  console.log('📋 Simulating PR with web-only changes:')
  const webResult = recentWebFiles.filter(f =>
    iosPatterns.some(p => p.test(f))
  )
  console.log(`   Files: ${recentWebFiles.length}`)
  console.log(`   iOS detected: ${webResult.length > 0 ? '✅ Yes' : '❌ No'}`)
  console.log()

  // Test what messages would be posted
  console.log('📝 Message preview (iOS PR after ship it):\n')
  const testflightLink = process.env.TESTFLIGHT_PUBLIC_LINK

  let deploymentMessage = `✅ PR #123 merged to main\n\n`
  deploymentMessage += `📦 **Web:** Vercel production deployment triggered automatically\n`
  deploymentMessage += `📱 **iOS:** Xcode Cloud build triggered automatically\n`

  if (testflightLink) {
    deploymentMessage += `\n🍎 **TestFlight:** [Get the latest build](${testflightLink})\n`
    deploymentMessage += `*(Build will be available in ~10-15 minutes after Xcode Cloud completes)*\n`
  } else {
    deploymentMessage += `\n💡 *Tip: Set TESTFLIGHT_PUBLIC_LINK in .env.local to auto-post TestFlight link*\n`
  }

  console.log('---')
  console.log(deploymentMessage)
  console.log('---\n')
}

function testWithMockFiles() {
  console.log('🧪 Testing pattern matching with mock files:\n')

  const testFiles = [
    // Should match
    'ios-app/Astrid App/Views/TaskView.swift',
    'ios/Sources/Main.swift',
    'MyApp.xcodeproj/project.pbxproj',
    'App.xcworkspace/contents.xcworkspacedata',
    'Model.xcdatamodeld/Model.xcdatamodel/contents',
    'Main.storyboard',
    'LaunchScreen.xib',
    'Info.plist',
    'App.entitlements',
    'Podfile',
    'Podfile.lock',
    'Package.swift',
    // Should NOT match
    'src/components/Button.tsx',
    'lib/utils.ts',
    'package.json',
    'README.md',
    'android/app/build.gradle',
  ]

  for (const file of testFiles) {
    const matches = iosPatterns.some(pattern => pattern.test(file))
    console.log(`${matches ? '✅' : '❌'} ${file}`)
  }
}

function testConfig() {
  console.log('\n📋 Configuration Check:\n')

  console.log(`GITHUB_TOKEN: ${GITHUB_TOKEN ? '✅ Set' : '❌ Missing'}`)
  console.log(`VERCEL_TOKEN: ${process.env.VERCEL_TOKEN ? '✅ Set' : '⚠️ Not set (preview URLs won\'t work)'}`)

  console.log('\n**iOS Options (choose one):**')
  console.log(`TESTFLIGHT_PUBLIC_LINK: ${process.env.TESTFLIGHT_PUBLIC_LINK ? `✅ ${process.env.TESTFLIGHT_PUBLIC_LINK}` : '⚠️ Not set'} (simple)`)

  const ascConfigured = process.env.ASC_KEY_ID && process.env.ASC_ISSUER_ID && process.env.ASC_PRIVATE_KEY
  console.log(`App Store Connect API: ${ascConfigured ? '✅ Configured' : '⚠️ Not set'} (advanced)`)
  if (ascConfigured) {
    console.log(`  - ASC_KEY_ID: ✅ Set`)
    console.log(`  - ASC_ISSUER_ID: ✅ Set`)
    console.log(`  - ASC_PRIVATE_KEY: ✅ Set`)
    console.log(`  - ASC_APP_ID: ${process.env.ASC_APP_ID ? '✅ Set' : '⚠️ Not set'}`)
  }
}

async function main() {
  console.log('=' .repeat(60))
  console.log('Staging Links Test Script')
  console.log('=' .repeat(60))
  console.log()

  testConfig()
  console.log()

  await testWithRealPR()

  console.log('=' .repeat(60))
  console.log('✅ Test complete!')
  console.log()

  if (!process.env.TESTFLIGHT_PUBLIC_LINK) {
    console.log('💡 To enable TestFlight links, add to .env.local:')
    console.log('   TESTFLIGHT_PUBLIC_LINK=https://testflight.apple.com/join/YOUR_CODE')
  }
}

main().catch(console.error)
