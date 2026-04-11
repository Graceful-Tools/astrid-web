#!/usr/bin/env npx tsx

/**
 * Authentication Smoke Test
 * 
 * This script tests the core authentication functionality to ensure
 * it's working properly and hasn't regressed.
 * 
 * Run with: npx tsx scripts/test-auth-smoke.ts
 */

import bcrypt from 'bcryptjs'

const API_BASE = 'http://localhost:3000'
const TEST_EMAIL = `smoke-test-${Date.now()}@example.com`
const TEST_PASSWORD = 'smoketest123'

interface TestResult {
  name: string
  passed: boolean
  error?: string
  details?: any
}

class AuthSmokeTest {
  private results: TestResult[] = []

  private addResult(name: string, passed: boolean, error?: string, details?: any) {
    this.results.push({ name, passed, error, details })
    const status = passed ? '✅' : '❌'
    console.log(`${status} ${name}`)
    if (error) console.log(`   Error: ${error}`)
    if (details && !passed) console.log(`   Details:`, details)
  }

  async testProviders() {
    try {
      const response = await fetch(`${API_BASE}/api/auth/providers`)
      const providers = await response.json()

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      if (!providers.credentials || !providers.google) {
        throw new Error(`Missing providers. Found: ${Object.keys(providers).join(', ')}`)
      }

      if (providers.credentials.type !== 'credentials') {
        throw new Error(`Credentials provider type is ${providers.credentials.type}, expected 'credentials'`)
      }

      if (providers.google.type !== 'oauth') {
        throw new Error(`Google provider type is ${providers.google.type}, expected 'oauth'`)
      }

      this.addResult('NextAuth providers configured', true)
    } catch (error) {
      this.addResult('NextAuth providers configured', false, error instanceof Error ? error.message : String(error))
    }
  }

  async testCSRF() {
    try {
      const response = await fetch(`${API_BASE}/api/auth/csrf`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      if (!data.csrfToken || typeof data.csrfToken !== 'string') {
        throw new Error(`Invalid CSRF token: ${data.csrfToken}`)
      }

      this.addResult('CSRF token generation', true)
    } catch (error) {
      this.addResult('CSRF token generation', false, error instanceof Error ? error.message : String(error))
    }
  }

  async testSignup() {
    try {
      const response = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          name: 'Smoke Test User'
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${data.error}`)
      }

      if (!data.success || !data.user?.email) {
        throw new Error(`Invalid response: ${JSON.stringify(data)}`)
      }

      this.addResult('User signup', true, undefined, { userId: data.user.id })
    } catch (error) {
      this.addResult('User signup', false, error instanceof Error ? error.message : String(error))
    }
  }

  async testDuplicateSignup() {
    try {
      const response = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          name: 'Duplicate User'
        })
      })

      const data = await response.json()

      if (response.status !== 409) {
        throw new Error(`Expected 409 status, got ${response.status}`)
      }

      if (!data.error || !data.error.includes('already exists')) {
        throw new Error(`Expected duplicate error, got: ${data.error}`)
      }

      this.addResult('Duplicate signup rejection', true)
    } catch (error) {
      this.addResult('Duplicate signup rejection', false, error instanceof Error ? error.message : String(error))
    }
  }

  async testPasswordValidation() {
    try {
      // Test short password
      const shortPwResponse = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `short-pw-${Date.now()}@example.com`,
          password: '123',
          name: 'Short Password User'
        })
      })

      const shortPwData = await shortPwResponse.json()

      if (shortPwResponse.status !== 400) {
        throw new Error(`Expected 400 for short password, got ${shortPwResponse.status}`)
      }

      if (!shortPwData.error || !shortPwData.error.includes('6 characters')) {
        throw new Error(`Expected password length error, got: ${shortPwData.error}`)
      }

      // Test invalid email
      const invalidEmailResponse = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invalid-email',
          password: 'validpass123',
          name: 'Invalid Email User'
        })
      })

      const invalidEmailData = await invalidEmailResponse.json()

      if (invalidEmailResponse.status !== 400) {
        throw new Error(`Expected 400 for invalid email, got ${invalidEmailResponse.status}`)
      }

      if (!invalidEmailData.error || !invalidEmailData.error.includes('Invalid email')) {
        throw new Error(`Expected email format error, got: ${invalidEmailData.error}`)
      }

      this.addResult('Input validation', true)
    } catch (error) {
      this.addResult('Input validation', false, error instanceof Error ? error.message : String(error))
    }
  }

  async testCredentialsAuthentication() {
    try {
      // This test verifies the credentials can authenticate by checking the user exists
      // and password can be validated (without testing the full NextAuth flow)
      const { prisma } = require('../lib/prisma')
      
      const user = await prisma.user.findUnique({
        where: { email: TEST_EMAIL },
        select: { id: true, email: true, password: true }
      })

      if (!user) {
        throw new Error('Test user not found in database')
      }

      if (!user.password) {
        throw new Error('Test user has no password')
      }

      const isPasswordValid = await bcrypt.compare(TEST_PASSWORD, user.password)
      if (!isPasswordValid) {
        throw new Error('Password validation failed')
      }

      this.addResult('Credentials authentication logic', true, undefined, { userId: user.id })
    } catch (error) {
      this.addResult('Credentials authentication logic', false, error instanceof Error ? error.message : String(error))
    }
  }

  async testAuthConfiguration() {
    try {
      // Test that auth config has the right structure
      const { authConfig } = require('../lib/auth-config')
      
      if (authConfig.session.strategy !== 'jwt') {
        throw new Error(`Session strategy is ${authConfig.session.strategy}, expected 'jwt'`)
      }

      if (!authConfig.callbacks.jwt) {
        throw new Error('Missing JWT callback')
      }

      if (!authConfig.callbacks.session) {
        throw new Error('Missing session callback')
      }

      const providerIds = authConfig.providers.map((p: any) => p.id)
      if (!providerIds.includes('credentials')) {
        throw new Error(`Missing credentials provider. Found: ${providerIds.join(', ')}`)
      }

      if (!providerIds.includes('google')) {
        throw new Error(`Missing Google provider. Found: ${providerIds.join(', ')}`)
      }

      this.addResult('Authentication configuration', true)
    } catch (error) {
      this.addResult('Authentication configuration', false, error instanceof Error ? error.message : String(error))
    }
  }

  async cleanup() {
    try {
      const { prisma } = require('../lib/prisma')
      await prisma.user.deleteMany({
        where: { email: TEST_EMAIL }
      })
      this.addResult('Cleanup test user', true)
    } catch (error) {
      this.addResult('Cleanup test user', false, error instanceof Error ? error.message : String(error))
    }
  }

  async run() {
    console.log('🧪 Running Authentication Smoke Tests')
    console.log('====================================')
    
    await this.testProviders()
    await this.testCSRF()
    await this.testAuthConfiguration()
    await this.testSignup()
    await this.testDuplicateSignup()
    await this.testPasswordValidation()
    await this.testCredentialsAuthentication()
    await this.cleanup()

    console.log('\n📊 Test Results:')
    console.log('================')
    
    const passed = this.results.filter(r => r.passed).length
    const failed = this.results.filter(r => !r.passed).length
    const total = this.results.length

    console.log(`Total: ${total}`)
    console.log(`✅ Passed: ${passed}`)
    console.log(`❌ Failed: ${failed}`)

    if (failed > 0) {
      console.log('\n🚨 Failed Tests:')
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`   - ${r.name}: ${r.error}`)
      })
      process.exit(1)
    } else {
      console.log('\n🎉 All tests passed! Authentication is working properly.')
      process.exit(0)
    }
  }
}

// Run the tests
new AuthSmokeTest().run().catch(error => {
  console.error('❌ Smoke test failed:', error)
  process.exit(1)
})