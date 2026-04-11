/**
 * Test script to send an actual email reminder with the new design
 * Run with: npx tsx scripts/test-email-reminder.ts
 */

import { EmailReminderService } from '../lib/email-reminder-service'
import type { TaskReminderData } from '../types/reminder'

async function testEmailReminder() {
  const emailService = new EmailReminderService()

  // Test data - normal reminder
  const normalReminderData: TaskReminderData = {
    taskId: 'test-task-123',
    title: 'Review project proposal and submit feedback',
    dueDateTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
    assigneeEmail: process.env.TEST_EMAIL || 'test@example.com',
    assigneeName: 'Test User',
    listNames: ['Work Projects', 'Q4 Goals'],
    collaborators: [
      { id: '1', name: 'Sarah Chen', email: 'sarah@example.com' },
      { id: '2', name: 'Mike Johnson', email: 'mike@example.com' },
      { id: '3', name: 'Lisa Wang', email: 'lisa@example.com' },
    ],
  }

  // Test data - overdue reminder
  const overdueReminderData: TaskReminderData = {
    taskId: 'test-task-456',
    title: 'Submit quarterly report',
    dueDateTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
    assigneeEmail: process.env.TEST_EMAIL || 'test@example.com',
    assigneeName: 'Test User',
    listNames: ['Urgent Tasks'],
    collaborators: [
      { id: '4', name: 'John Doe', email: 'john@example.com' },
      { id: '5', name: 'Jane Smith', email: 'jane@example.com' },
    ],
  }

  console.log('📧 Testing Email Reminder Service...\n')
  console.log('🔹 Sending NORMAL reminder (with collaborators)...')

  try {
    await emailService.sendTaskReminder(normalReminderData)
    console.log('✅ Normal reminder sent successfully!')
  } catch (error) {
    console.error('❌ Failed to send normal reminder:', error)
  }

  console.log('\n🔹 Sending OVERDUE reminder (with collaborators)...')

  try {
    await emailService.sendTaskReminder(overdueReminderData)
    console.log('✅ Overdue reminder sent successfully!')
  } catch (error) {
    console.error('❌ Failed to send overdue reminder:', error)
  }

  console.log('\n📝 Note: In development mode, emails are logged to console.')
  console.log('📝 To send real emails, set RESEND_API_KEY in .env.local')
  console.log('📝 Set TEST_EMAIL environment variable to test with your email')
}

testEmailReminder().catch(console.error)
