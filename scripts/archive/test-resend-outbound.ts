/**
 * Test Resend Outbound Email
 *
 * Tests that Resend can send emails (invitations, verification, reminders)
 *
 * Usage:
 *   npx tsx scripts/test-resend-outbound.ts <test-type> <email>
 *
 * Test types:
 *   - verification: Send email verification
 *   - invitation: Send list invitation
 *   - reminder: Send task reminder
 *
 * Examples:
 *   npx tsx scripts/test-resend-outbound.ts verification you@example.com
 *   npx tsx scripts/test-resend-outbound.ts invitation you@example.com
 */

import { sendVerificationEmail } from '@/lib/email'
import { sendListInvitationEmail } from '@/lib/email'
// TODO: Reminder service needs to export sendTaskReminderEmail
// import { sendTaskReminderEmail } from '@/lib/email-reminder-service'

const testType = process.argv[2]
const testEmail = process.argv[3]

if (!testType || !testEmail) {
  console.error('Usage: npx tsx scripts/test-resend-outbound.ts <test-type> <email>')
  console.error('')
  console.error('Test types: verification, invitation, reminder')
  process.exit(1)
}

async function main() {
  console.log(`🧪 Testing Resend outbound: ${testType}`)
  console.log(`📧 Sending to: ${testEmail}`)
  console.log('')

  try {
    switch (testType) {
      case 'verification':
        await sendVerificationEmail({
          email: testEmail,
          token: 'test-token-' + Date.now(),
          userName: 'Test User',
          isEmailChange: false,
        })
        console.log('✅ Verification email sent successfully')
        break

      case 'invitation':
        await sendListInvitationEmail({
          to: testEmail,
          inviterName: 'Jon Paris',
          listName: 'Test Task List',
          role: 'member',
          invitationUrl: 'https://astrid.cc/invite/test-token-' + Date.now(),
          message: 'This is a test invitation from Astrid',
        })
        console.log('✅ List invitation email sent successfully')
        break

      // TODO: Re-enable when sendTaskReminderEmail is exported
      // case 'reminder':
      //   await sendTaskReminderEmail({
      //     to: testEmail,
      //     taskTitle: 'Test Task Reminder',
      //     taskDescription: 'This is a test reminder from Astrid',
      //     taskUrl: 'https://astrid.cc/tasks/test-task',
      //     dueDate: new Date(),
      //   })
      //   console.log('✅ Task reminder email sent successfully')
      //   break

      default:
        console.error('❌ Unknown test type:', testType)
        console.error('Valid types: verification, invitation, reminder')
        process.exit(1)
    }

    console.log('')
    console.log('📊 Next steps:')
    console.log('1. Check your inbox at', testEmail)
    console.log('2. Verify email was received (check spam folder too)')
    console.log('3. Check Resend dashboard: https://resend.com/emails')
    console.log('4. Verify SPF/DKIM passed in email headers')

  } catch (error) {
    console.error('❌ Error sending email:', error)
    if (error instanceof Error) {
      console.error('   Message:', error.message)
      console.error('   Stack:', error.stack)
    }
    process.exit(1)
  }
}

main()
