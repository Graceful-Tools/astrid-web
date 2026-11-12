import { Fragment, type ReactNode } from "react"

/**
 * Draw the tags in a translated sentence ("Go to <b>Settings</b> → <b>Account</b>") as
 * elements, so a translator can move the bold or the keyboard key with the words (AWTD-1613).
 *
 * next-intl's `t.rich` does this, but calling its `useTranslations` from a client component
 * puts its message formatter into every route's first load (+2 KiB gzipped, against a
 * ceiling with 1.3 KiB to spare; docs/PERFORMANCE_BUDGETS.md). The app's own `t()` reads
 * the same messages; this adds only the tags.
 *
 * Tags are flat (no nesting) and must be named in `tags`; anything else stays as text.
 */
export function richText(message: string, tags: Record<string, (chunks: string) => ReactNode>): ReactNode {
  const names = Object.keys(tags)
  if (names.length === 0 || !message.includes("<")) return message
  const pattern = new RegExp(`<(${names.join("|")})>([\\s\\S]*?)</\\1>`, "g")
  const parts: ReactNode[] = []
  let last = 0
  for (const match of message.matchAll(pattern)) {
    if (match.index > last) parts.push(message.slice(last, match.index))
    parts.push(<Fragment key={parts.length}>{tags[match[1]](match[2])}</Fragment>)
    last = match.index + match[0].length
  }
  if (last < message.length) parts.push(message.slice(last))
  return parts
}
