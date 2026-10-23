#!/usr/bin/env tsx

/**
 * Test Type Suggestion Script
 *
 * Helps developers determine whether to create Vitest tests, Playwright E2E tests, or both
 * when fixing bugs or adding features.
 *
 * Usage:
 *   npx tsx scripts/suggest-test-type.ts
 */

import readline from 'readline'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim().toLowerCase())
    })
  })
}

interface TestRecommendation {
  vitest: boolean
  playwright: boolean
  reason: string
  vitestLocation?: string
  playwrightLocation?: string
  examples?: string[]
}

async function analyzeChange(): Promise<TestRecommendation> {
  console.log('\n🧪 Test Type Recommendation Tool\n')
  console.log('Answer a few questions to determine what tests to create:\n')

  // Question 1: Type of change
  console.log('1. What type of change are you making?')
  console.log('   a) Bug fix')
  console.log('   b) New feature')
  console.log('   c) Refactoring')
  const changeType = await ask('   Your answer (a/b/c): ')

  // Question 2: Component type
  console.log('\n2. What component are you working on?')
  console.log('   a) UI component (buttons, forms, etc.)')
  console.log('   b) API endpoint')
  console.log('   c) Utility function/hook')
  console.log('   d) Database/data layer')
  const componentType = await ask('   Your answer (a/b/c/d): ')

  // Question 3: User interaction
  console.log('\n3. Does this change affect user interaction?')
  console.log('   (clicks, typing, navigation, visual feedback)')
  const affectsUI = await ask('   Your answer (yes/no): ')

  // Question 4: Multi-step workflow
  console.log('\n4. Does this involve a multi-step user workflow?')
  console.log('   (e.g., create task → edit → complete)')
  const multiStep = await ask('   Your answer (yes/no): ')

  // Question 5: Responsive/cross-browser
  console.log('\n5. Does this change affect mobile/tablet layouts or need cross-browser testing?')
  const responsive = await ask('   Your answer (yes/no): ')

  // Analyze responses
  const recommendation: TestRecommendation = {
    vitest: false,
    playwright: false,
    reason: '',
  }

  // Logic for recommendations
  const needsPlaywright =
    affectsUI.startsWith('y') ||
    multiStep.startsWith('y') ||
    responsive.startsWith('y')

  const needsVitest =
    componentType === 'b' || // API
    componentType === 'c' || // Utility
    componentType === 'd' || // Database
    componentType === 'a'    // UI component (for logic)

  recommendation.vitest = needsVitest
  recommendation.playwright = needsPlaywright

  // Determine locations
  if (needsVitest) {
    if (componentType === 'b') {
      recommendation.vitestLocation = 'tests/api/'
    } else if (componentType === 'c') {
      recommendation.vitestLocation = 'tests/lib/ or tests/hooks/'
    } else if (componentType === 'd') {
      recommendation.vitestLocation = 'tests/api/ or tests/lib/'
    } else {
      recommendation.vitestLocation = 'tests/components/'
    }
  }

  if (needsPlaywright) {
    recommendation.playwrightLocation = 'e2e/'

    // Suggest specific E2E file
    console.log('\n6. Which area does this affect?')
    console.log('   a) Authentication/sign-in')
    console.log('   b) Tasks or lists (signed-in create, edit, complete, manage)')
    console.log('   c) Layout / mobile / responsive behavior')
    console.log('   d) Locale routing / i18n')
    console.log('   e) Other/new workflow')
    const area = await ask('   Your answer (a/b/c/d/e): ')

    // Only specs a Playwright project in playwright.config.ts actually runs.
    // A spec outside every project's testMatch is never executed (AWTD-1340).
    const areaMap: Record<string, string> = {
      a: 'e2e/auth.spec.ts',
      b: 'e2e/authenticated-critical-paths.spec.ts',
      c: 'e2e/layout-regression.spec.ts',
      d: 'e2e/locale-navigation.spec.ts',
      e: 'e2e/[feature-name].spec.ts (create new file AND add it to a project testMatch in playwright.config.ts, or it never runs)',
    }

    recommendation.playwrightLocation = areaMap[area] || 'e2e/'
  }

  // Generate reason
  if (recommendation.vitest && recommendation.playwright) {
    recommendation.reason = 'Create BOTH Vitest and Playwright tests - this change affects both logic and user interaction.'
  } else if (recommendation.vitest) {
    recommendation.reason = 'Create Vitest tests only - this is a logic/API change without direct user interaction.'
  } else if (recommendation.playwright) {
    recommendation.reason = 'Create Playwright E2E tests - this primarily affects user workflows and interactions.'
  } else {
    recommendation.reason = 'Based on your answers, you may not need new tests (refactoring with existing coverage).'
  }

  // Add examples
  if (recommendation.vitest && recommendation.playwright) {
    recommendation.examples = [
      'Vitest: Test the API endpoint or business logic',
      'Playwright: Test the complete user flow end-to-end',
    ]
  } else if (recommendation.vitest) {
    recommendation.examples = [
      'Test individual functions with various inputs',
      'Test edge cases and error handling',
      'Mock external dependencies',
    ]
  } else if (recommendation.playwright) {
    recommendation.examples = [
      'Test user interactions (clicks, typing)',
      'Test complete workflows',
      'Test across different viewports',
    ]
  }

  return recommendation
}

async function main() {
  const recommendation = await analyzeChange()

  console.log('\n' + '='.repeat(60))
  console.log('📊 TEST RECOMMENDATION')
  console.log('='.repeat(60))

  console.log(`\n${recommendation.reason}\n`)

  if (recommendation.vitest) {
    console.log('✅ CREATE VITEST TESTS')
    console.log(`   Location: ${recommendation.vitestLocation}`)
    console.log(`   Command: npm test ${recommendation.vitestLocation}`)
    console.log()
  }

  if (recommendation.playwright) {
    console.log('✅ CREATE PLAYWRIGHT E2E TESTS')
    console.log(`   Location: ${recommendation.playwrightLocation}`)
    console.log(`   Command: npm run test:e2e:ui ${recommendation.playwrightLocation}`)
    console.log()
  }

  if (recommendation.examples && recommendation.examples.length > 0) {
    console.log('💡 SUGGESTIONS:')
    recommendation.examples.forEach(example => {
      console.log(`   • ${example}`)
    })
    console.log()
  }

  console.log('📚 DOCUMENTATION:')
  console.log('   • Vitest patterns: tests/README.md')
  console.log('   • Playwright patterns: e2e/README.md')
  console.log('   • Test guidelines: CLAUDE.md (Test Selection Guidelines)')
  console.log()

  console.log('🚀 QUICK COMMANDS:')
  if (recommendation.vitest) {
    console.log('   npm test                          # Run Vitest tests')
    console.log('   npm test -- --ui                  # Vitest UI mode')
  }
  if (recommendation.playwright) {
    console.log('   npm run test:e2e:ui               # Playwright UI mode')
    console.log('   npm run test:e2e:headed           # Watch tests run')
  }
  console.log('   npm run predeploy:with-e2e        # Run all tests')
  console.log()

  console.log('='.repeat(60))

  rl.close()
}

main().catch((error) => {
  console.error('Error:', error)
  rl.close()
  process.exit(1)
})
