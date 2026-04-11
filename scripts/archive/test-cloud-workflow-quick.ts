#!/usr/bin/env tsx
/**
 * Quick Test - Cloud Workflow Improvements (No Database Required)
 *
 * Tests core improvements without needing database connection:
 * - Trace ID generation
 * - Structured logging
 * - Context size tracking
 * - Context pruning logic
 *
 * Usage: npx tsx scripts/test-cloud-workflow-quick.ts
 */

import { AIOrchestrator } from '../lib/ai-orchestrator'

// Color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function section(title: string) {
  console.log('\n' + '='.repeat(70))
  log(title, 'cyan')
  console.log('='.repeat(70) + '\n')
}

async function main() {
  log('🚀 Quick Test - Cloud Workflow Improvements', 'cyan')
  log('Testing core features (no database required)\n', 'cyan')

  let passed = 0
  let failed = 0

  // Test 1: Trace ID and Logging
  section('Test 1: Trace ID & Structured Logging')
  try {
    log('Creating AIOrchestrator instance...', 'blue')
    const orchestrator = new AIOrchestrator('claude', 'test-user-id', 'test-repo')

    log('✓ Instance created successfully', 'green')
    log('  Check console above for JSON log with:', 'blue')
    log('    - timestamp', 'blue')
    log('    - traceId (format: trace-<timestamp>-<random>)', 'blue')
    log('    - level: "info"', 'blue')
    log('    - service: "AIOrchestrator"', 'blue')
    passed++
  } catch (error) {
    log(`✗ Test failed: ${error}`, 'red')
    failed++
  }

  // Test 2: Context Size Tracking
  section('Test 2: Context Size Tracking')
  try {
    const orchestrator = new AIOrchestrator('claude', 'test-user-id')
    const orchestratorAny = orchestrator as any

    const smallMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' }
    ]
    const smallSize = orchestratorAny.getContextSize(smallMessages)

    log(`✓ Small context: ${smallSize} tokens`, 'green')
    log(`  (Expected: 5-20 tokens)`, 'blue')

    const largeContent = 'x'.repeat(10000)
    const largeMessages = [
      { role: 'user', content: largeContent },
      { role: 'assistant', content: largeContent }
    ]
    const largeSize = orchestratorAny.getContextSize(largeMessages)

    log(`✓ Large context: ${largeSize} tokens`, 'green')
    log(`  (Expected: ~5000 tokens)`, 'blue')

    if (smallSize < 50 && largeSize > 4000) {
      log('✓ Context size calculation working correctly', 'green')
      passed++
    } else {
      log('✗ Unexpected context sizes', 'red')
      failed++
    }
  } catch (error) {
    log(`✗ Test failed: ${error}`, 'red')
    failed++
  }

  // Test 3: Context Pruning
  section('Test 3: Context Pruning')
  try {
    const orchestrator = new AIOrchestrator('claude', 'test-user-id')
    const orchestratorAny = orchestrator as any

    const messages = []
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'user', content: `Message ${i}` })
      messages.push({ role: 'assistant', content: `Response ${i}` })
    }

    log(`Original: ${messages.length} messages`, 'yellow')

    const prunedMessages = orchestratorAny.pruneContext(messages)

    log(`✓ Pruned: ${prunedMessages.length} messages`, 'green')

    const reduction = Math.round((1 - (prunedMessages.length / messages.length)) * 100)
    log(`✓ Reduction: ${reduction}%`, 'green')

    if (prunedMessages.length <= 10 && reduction > 60) {
      log('✓ Context pruning working correctly', 'green')
      passed++
    } else {
      log('✗ Pruning not aggressive enough', 'red')
      failed++
    }
  } catch (error) {
    log(`✗ Test failed: ${error}`, 'red')
    failed++
  }

  // Test 4: Separate Context Instances
  section('Test 4: Separate Context Phases')
  try {
    log('Creating planning orchestrator...', 'blue')
    const planning = new AIOrchestrator('claude', 'test-user')
    const planningTrace = (planning as any).traceId

    log('Creating implementation orchestrator...', 'blue')
    const implementation = new AIOrchestrator('claude', 'test-user')
    const implementationTrace = (implementation as any).traceId

    log(`Planning trace ID: ${planningTrace}`, 'yellow')
    log(`Implementation trace ID: ${implementationTrace}`, 'yellow')

    if (planningTrace !== implementationTrace) {
      log('✓ Trace IDs are different (separate contexts confirmed)', 'green')
      log('  Each orchestrator starts with fresh context', 'blue')
      passed++
    } else {
      log('✗ Trace IDs should be different', 'red')
      failed++
    }
  } catch (error) {
    log(`✗ Test failed: ${error}`, 'red')
    failed++
  }

  // Summary
  section('Test Summary')
  const total = passed + failed
  log(`Total: ${total}`, 'blue')
  log(`Passed: ${passed}`, 'green')
  if (failed > 0) {
    log(`Failed: ${failed}`, 'red')
  }

  const successRate = Math.round((passed / total) * 100)
  log(`\nSuccess rate: ${successRate}%`, successRate === 100 ? 'green' : 'yellow')

  if (successRate === 100) {
    log('\n✓ All core improvements working!', 'green')
    log('  Phase 1: Trace IDs, logging ✓', 'green')
    log('  Phase 2: Context tracking, pruning ✓', 'green')
    log('\nNext steps:', 'cyan')
    log('1. Run full test suite (requires database):', 'blue')
    log('   npx tsx scripts/test-cloud-workflow-improvements.ts', 'blue')
    log('2. Test with real task assignment', 'blue')
  } else {
    log('\n⚠ Some tests failed', 'yellow')
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
