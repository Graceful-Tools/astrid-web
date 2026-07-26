/**
 * Identify which AI provider an agent corresponds to from its email or name.
 *
 * Originally inline at the top of lib/ai-agent-webhook-service.ts; promoted
 * to its own module so the soon-to-be-extracted comment-notifier and
 * task-assignment-notifier can share it.
 *
 * Email-first matching: any *@astrid.cc address whose local part is one of
 * the four known prefixes routes deterministically. The {name}.oc@astrid.cc
 * suffix routes to OpenClaw regardless of the chosen prefix. Name fallback
 * is a substring match for users who have set a display name but whose
 * email doesn't follow the convention.
 */
export function getAgentType(email?: string, name?: string): string | null {
  if (email?.match(/^[a-z0-9._-]+\.oc@astrid\.cc$/i)) {
    return 'openclaw'
  }

  if (email?.endsWith('@astrid.cc')) {
    const prefix = email.split('@')[0].toLowerCase()
    if (['claude', 'openai', 'gemini', 'copilot', 'openclaw'].includes(prefix)) {
      return prefix
    }
  }

  if (name) {
    const lowerName = name.toLowerCase()
    if (lowerName.includes('claude')) return 'claude'
    if (lowerName.includes('openai') || lowerName.includes('gpt')) return 'openai'
    if (lowerName.includes('gemini')) return 'gemini'
    if (lowerName.includes('copilot')) return 'copilot'
    if (lowerName.includes('openclaw') || lowerName.includes('claw')) return 'openclaw'
  }

  return null
}
