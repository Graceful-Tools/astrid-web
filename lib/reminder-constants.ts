// Reminder strings from original Astrid app - now i18n-enabled
// https://github.com/Graceful-Tools/astrid/blob/master/astrid/res/values/strings-reminders.xml

import { BRAND } from '@/lib/brand/config'
import { applyBrandToMessages } from '@/lib/brand/i18n-values'

// Import locale messages dynamically based on locale parameter
async function getMessages(locale: string = 'en') {
  try {
    return applyBrandToMessages(await import(`@/lib/i18n/locales/${locale}.json`).then(m => m.default))
  } catch {
    // Fallback to English
    return applyBrandToMessages(await import('@/lib/i18n/locales/en.json').then(m => m.default))
  }
}

// Helper function to get a random string from an array
export function getRandomReminderString(
  type: 'reminders' | 'reminders_due' | 'reminder_responses',
  locale: string = 'en',
  messages?: any
): string {
  if (!messages) {
    // Fallback to English if no messages provided
    const fallback = {
      reminders: ["Hi there! Have a sec?"],
      reminders_due: ["Time to work!"],
      reminder_responses: ["Ready to do this?"]
    }
    const strings = fallback[type] || []
    return strings[0] || ""
  }

  let strings: string[] = []
  if (type === 'reminders') {
    strings = messages.reminders?.general || []
  } else if (type === 'reminders_due') {
    strings = messages.reminders?.due || []
  } else if (type === 'reminder_responses') {
    strings = messages.reminders?.responses || []
  }

  if (strings.length === 0) return ""
  return strings[Math.floor(Math.random() * strings.length)]
}

// Helper function to format social accountability message
export function getSocialAccountabilityMessage(
  members: { name?: string; email: string }[],
  locale: string = 'en',
  messages?: any
): string {
  if (members.length === 0) return ""

  const socialMessages = messages?.reminders?.social || {
    one: "{name} is counting on you!",
    multiple: "These people are counting on you!",
    multipleNames: "{name1}, {name2}, and others are counting on you!"
  }

  if (members.length === 1) {
    const name = members[0].name || members[0].email.split('@')[0]
    return socialMessages.one.replace('{name}', name)
  } else if (members.length === 2) {
    const name1 = members[0].name || members[0].email.split('@')[0]
    const name2 = members[1].name || members[1].email.split('@')[0]
    return socialMessages.multipleNames
      .replace('{name1}', name1)
      .replace('{name2}', name2)
  } else {
    const name1 = members[0].name || members[0].email.split('@')[0]
    const name2 = members[1].name || members[1].email.split('@')[0]
    return socialMessages.multipleNames
      .replace('{name1}', name1)
      .replace('{name2}', name2)
  }
}

// Legacy export for backwards compatibility (uses English)
export const REMINDER_STRINGS = {
  reminders: [
    "Hi there! Have a sec?",
    "Can I see you for a sec?",
    "Have a few minutes?",
    "Did you forget?",
    "Excuse me!",
    "When you have a minute:",
    "On your agenda:",
    "Free for a moment?",
    `${BRAND.appName} here!`,
    "Hi! Can I bug you?",
    "A minute of your time?",
    "It's a great day to"
  ],
  reminders_due: [
    "Time to work!",
    "Due date is here!",
    "Ready to start?",
    "You said you would do:",
    "You're supposed to start:",
    "Time to start:",
    "It's time!",
    "Excuse me! Time for",
    "You free? Time to"
  ],
  reminder_responses: [
    "I've got something for you!",
    "Ready to put this in the past?",
    "Why don't you get this done?",
    "How about it? Ready tiger?",
    "Ready to do this?",
    "Can you handle this?",
    "You can be happy! Just finish this!",
    "I promise you'll feel better if you finish this!",
    "Won't you do this today?",
    "Please finish this, I'm sick of it!",
    "Can you finish this? Yes you can!",
    "Are you ever going to do this?",
    "Feel good about yourself! Let's go!",
    "I'm so proud of you! Lets get it done!",
    "A little snack after you finish this?",
    "Just this one task? Please?",
    "Time to shorten your todo list!",
    "Are you on Team Order or Team Chaos? Team Order! Let's go!",
    "Have I mentioned you are awesome recently? Keep it up!",
    "A task a day keeps the clutter away... Goodbye clutter!",
    "How do you do it? Wow, I'm impressed!",
    "You can't just get by on your good looks. Let's get to it!",
    "Lovely weather for a job like this, isn't it?",
    "A spot of tea while you work on this?",
    "If only you had already done this, then you could go outside and play.",
    "It's time. You can't put off the inevitable.",
    "I die a little every time you ignore me."
  ],
  social: {
    multiple: "These people are counting on you!",
    one: "{name} is counting on you!",
    multiple_names: "{name1}, {name2}, and others are counting on you!"
  },
  ui: {
    reminder_title: "Reminder:",
    snooze: "Snooze",
    complete: "Complete!",
    completed_toast: "Congratulations on finishing!"
  }
} as const
