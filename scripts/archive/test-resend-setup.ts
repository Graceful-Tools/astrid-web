/**
 * Test Resend Setup
 *
 * Tests both outbound email and webhook endpoint
 */

import { Resend } from 'resend'
import 'dotenv/config'

async function testResendSetup() {
  console.log('\n🧪 Testing Resend Configuration...\n')

  // Check environment variables
  console.log('📋 Environment Check:')
  console.log(`  RESEND_API_KEY: ${process.env.RESEND_API_KEY ? '✅ Set' : '❌ Missing'}`)
  console.log(`  FROM_EMAIL: ${process.env.FROM_EMAIL || '❌ Not set'}`)
  console.log(`  RESEND_WEBHOOK_SECRET: ${process.env.RESEND_WEBHOOK_SECRET ? '✅ Set' : '⚠️  Not set (optional)'}`)
  console.log()

  if (!process.env.RESEND_API_KEY) {
    console.error('❌ RESEND_API_KEY not found in environment variables')
    process.exit(1)
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const fromEmail = process.env.FROM_EMAIL || 'noreply@astrid.cc'

  // Test 1: Send test email
  console.log('📧 Test 1: Sending test email...')
  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: ['jon@gracefultools.com'], // Your email
      subject: '✅ Resend Setup Test - Outbound Email',
      html: `
        <h2>Resend Configuration Successful!</h2>
        <p>This test email confirms that:</p>
        <ul>
          <li>✅ API key is valid</li>
          <li>✅ Domain is verified</li>
          <li>✅ Outbound email is working</li>
        </ul>
        <p><strong>From:</strong> ${fromEmail}</p>
        <p><strong>Sent:</strong> ${new Date().toISOString()}</p>
        <hr>
        <p><em>Next step: Test inbound email by sending to remindme@astrid.cc</em></p>
      `,
      text: 'Resend setup successful! API key and domain verified. Test inbound email by sending to remindme@astrid.cc'
    })

    if (error) {
      console.error('❌ Error sending email:', error)
      console.log()
      if (error.message?.includes('Domain not found')) {
        console.log('💡 Domain not verified yet. Check Resend dashboard:')
        console.log('   https://resend.com/domains')
      }
      process.exit(1)
    }

    console.log('✅ Test email sent successfully!')
    console.log(`   Email ID: ${data?.id}`)
    console.log(`   Check inbox: jon@gracefultools.com`)
    console.log()
  } catch (error) {
    console.error('❌ Failed to send test email:', error)
    process.exit(1)
  }

  // Test 2: Check webhook endpoint
  console.log('🔗 Test 2: Checking webhook endpoint...')
  try {
    const response = await fetch('https://www.astrid.cc/api/webhooks/email')
    const data = await response.json()

    if (response.ok) {
      console.log('✅ Webhook endpoint is accessible')
      console.log(`   Status: ${response.status}`)
      console.log(`   Response:`, data)
    } else {
      console.log('⚠️  Webhook endpoint returned error')
      console.log(`   Status: ${response.status}`)
    }
  } catch (error) {
    console.log('⚠️  Could not reach webhook endpoint (may not be deployed yet)')
    console.log('   This is OK for local development')
  }
  console.log()

  // Instructions
  console.log('📝 Next Steps:')
  console.log()
  console.log('1. ✅ Verify you received the test email at jon@gracefultools.com')
  console.log()
  console.log('2. 📧 Test inbound email:')
  console.log('   Send email TO: remindme@astrid.cc')
  console.log('   Subject: Test Task')
  console.log('   Body: This is a test task')
  console.log()
  console.log('3. ✅ Check if task was created:')
  console.log('   - Log in to Astrid')
  console.log('   - Look for task titled "Test Task"')
  console.log()
  console.log('4. 🔍 Debug if needed:')
  console.log('   - Resend logs: https://resend.com/inbound')
  console.log('   - Webhook logs: vercel logs --project=astrid-www --follow')
  console.log()

  console.log('✅ Setup test complete!\n')
}

testResendSetup().catch(console.error)
