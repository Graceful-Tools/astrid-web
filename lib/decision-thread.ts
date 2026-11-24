/**
 * Whether a question asked in a comment is still open, and what answered it. The web port of
 * iOS's `DecisionThread.answer` (AITD-579, ADEV-232; web ADEV-248).
 *
 * A Decision's options draw as cards or a grid; choosing one posts its number and words as an
 * ordinary reply, so the server holds no decision state and the thread is the only record.
 */
import { chosenNumber, type DecisionOption } from '@/lib/comment-formats'
import { isSystemComment, type StreakComment } from '@/lib/completion-streak'

export type ThreadComment = StreakComment

const time = (c: ThreadComment) => new Date(c.createdAt).getTime()

/**
 * The first comment after `asked` that answers it, or null while nobody has: a reply from someone
 * else, or the asker's own reply choosing one of its options (someone weighing their own trade-off
 * chooses too). A system line and the asker's follow-up in words are not answers.
 */
export function decisionAnswer<T extends ThreadComment>(
  asked: ThreadComment,
  comments: T[],
  options: DecisionOption[],
): T | null {
  const askedAt = time(asked)
  return comments
    .filter(c => c.id !== asked.id && !isSystemComment(c) && time(c) > askedAt)
    .sort((a, b) => time(a) - time(b))
    .find(c => c.authorId !== asked.authorId || chosenNumber(c.content, options) !== null) ?? null
}
