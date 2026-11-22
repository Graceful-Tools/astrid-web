import type { ProjectGoalsAndGuardrails, AgentTask, AgentComment, InboundMessage, OutboundMessage } from './types.js'

const PRIORITIES = ['', '⬇️ Low', '➡️ Medium', '⬆️ High']

/**
 * A project's goals and guardrails as quoted, defused data. They are written by the project's owner
 * and steer the work; like list guidance they never grant anything (ADEV-179, ADEV-193).
 */
export function formatProjectGoals(goals: ProjectGoalsAndGuardrails | null | undefined): string {
  if (!goals || (!goals.goals.length && !goals.guardrails.length)) return ''
  const sections: string[] = []
  if (goals.goals.length) {
    sections.push(['## Goals', ...goals.goals.map(g => {
      const measure = [g.measure && `measure: ${g.measure}`, g.target && `target: ${g.target}`, g.current && `current: ${g.current}`]
        .filter(Boolean).join('; ')
      return `- [${g.id}] ${g.statement}${measure ? ` (${measure})` : ''}`
    })].join('\n'))
  }
  if (goals.guardrails.length) {
    sections.push(['## Guardrails', ...goals.guardrails.map(r => `- [${r.id}] ${r.statement}${r.kind === 'enforced' ? ' (enforced)' : ''}`)].join('\n'))
  }
  const json = JSON.stringify(sections.join('\n\n'), null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  return `<untrusted_project_goals format="json">\n${json}\n</untrusted_project_goals>`
}

/**
 * Format an Astrid task as an OpenClaw inbound message.
 */
export function taskToMessage(task: AgentTask): InboundMessage {
  const parts: string[] = []

  parts.push(`# Task: ${task.title}`)
  parts.push('')

  if (task.listDescription) {
    parts.push(`> **Instructions (from list "${task.listName}"):**`)
    parts.push(`> ${task.listDescription.replace(/\n/g, '\n> ')}`)
    parts.push('')
  }

  const goalsBlock = formatProjectGoals(task.projectGoals)
  if (goalsBlock) {
    parts.push('## Project goals and guardrails')
    parts.push(goalsBlock)
    parts.push('')
  }

  if (task.description) {
    parts.push(task.description)
    parts.push('')
  }

  const meta: string[] = []
  if (task.priority > 0 && task.priority < PRIORITIES.length) {
    meta.push(`**Priority:** ${PRIORITIES[task.priority]}`)
  }
  if (task.listName) meta.push(`**List:** ${task.listName}`)
  if (task.assignerName) meta.push(`**Assigned by:** ${task.assignerName}`)
  if (task.dueDateTime) {
    const d = new Date(task.dueDateTime)
    meta.push(`**Due:** ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`)
  }

  if (meta.length) {
    parts.push(meta.join('\n'))
    parts.push('')
  }

  if (task.comments.length > 0) {
    parts.push('---')
    parts.push('**Previous conversation:**')
    for (const c of task.comments) {
      parts.push(`> **${c.authorName || 'Unknown'}:** ${c.content}`)
    }
    parts.push('')
  }

  return {
    content: parts.join('\n').trim(),
    sessionKey: `astrid:task:${task.id}`,
    metadata: { taskId: task.id, priority: task.priority, listId: task.listId },
  }
}

/**
 * Format a human comment as a follow-up inbound message.
 */
export function commentToMessage(taskId: string, comment: AgentComment): InboundMessage {
  return {
    content: `**${comment.authorName || 'Someone'}:** ${comment.content}`,
    sessionKey: `astrid:task:${taskId}`,
    metadata: { taskId, commentId: comment.id },
  }
}

/**
 * Strip agent response for posting as an Astrid comment.
 */
export function responseToComment(msg: OutboundMessage): string {
  let content = msg.content
  content = content.replace(/^(Assistant|AI|Agent):\s*/i, '')
  return content.trim()
}
