/**
 * Arguments for scripts/add-task-comment.ts (ADEV-34).
 *
 * `<taskId> "<content>" [--agent <mailbox>]`, with the flag accepted anywhere.
 * The script used to read argv[3] as the content, so `<id> --agent claude "text"`
 * posted the literal comment "--agent" and dropped the text. Anything that looks
 * like a flag is parsed as one or refused; it is never posted as a comment.
 */
const USAGE = 'Usage: npx tsx scripts/add-task-comment.ts <taskId> "<comment content>" [--agent <mailbox>]'

export function parseCommentArgs(argv: string[]): { taskId: string; content: string; mailbox: string } {
  let mailbox = 'claude'
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--agent') {
      const value = argv[++i]
      if (!value || value.startsWith('--')) throw new Error(`--agent needs a mailbox. ${USAGE}`)
      mailbox = value
    } else if (arg.startsWith('--agent=')) {
      mailbox = arg.slice('--agent='.length)
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag ${arg}. ${USAGE}`)
    } else {
      positional.push(arg)
    }
  }
  const [taskId, content, ...extra] = positional
  if (!taskId || !content?.trim()) throw new Error(USAGE)
  if (extra.length > 0) throw new Error(`Pass one comment, quoted. ${USAGE}`)
  return { taskId, content, mailbox }
}
