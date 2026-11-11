import { Fragment, type ReactNode } from "react"

const PLACEHOLDER = /\{(\w+)\}/g

/**
 * A translated sentence with something other than text in the middle of it: a
 * bold word, a link, a `<code>` address.
 *
 * The message keeps its `{placeholders}` and no markup, so a translator can
 * move them wherever the language wants them; the element for each one is
 * passed here. A placeholder with no value is left as written.
 *
 *   <RichMessage message={t("…loopDescription")} values={{ ready: <strong>Ready</strong> }} />
 */
export function RichMessage({ message, values }: { message: string; values: Record<string, ReactNode> }) {
  const parts = message.split(PLACEHOLDER)
  return (
    <>
      {parts.map((part, index) =>
        // split() with one capture group alternates text, name, text, name …
        index % 2 === 0 ? part : <Fragment key={index}>{part in values ? values[part] : `{${part}}`}</Fragment>,
      )}
    </>
  )
}

/**
 * The same for a plain string (an aria-label, a title, a toast). Unlike the
 * replacements `t()` takes, a value is inserted literally, so a name a person
 * typed ("Cash $& carry") cannot be read as a replacement pattern.
 */
export function fillMessage(message: string, values: Record<string, string>): string {
  return message.replace(PLACEHOLDER, (match, name: string) => (name in values ? values[name] : match))
}
