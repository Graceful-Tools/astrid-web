import DOMPurify from 'dompurify'
import { marked } from 'marked'

// Allowed URL protocols for links
const SAFE_URL_PROTOCOLS = ['http:', 'https:', 'mailto:']

/**
 * Validate that a URL uses a safe protocol
 * Prevents javascript: and data: URL injection
 */
function isSafeUrl(url: string): boolean {
  try {
    // Add protocol if missing for URL parsing
    const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`
    const parsed = new URL(urlWithProtocol)
    return SAFE_URL_PROTOCOLS.includes(parsed.protocol)
  } catch {
    // If URL parsing fails, it's not a valid URL
    return false
  }
}

/**
 * Escape HTML special characters to prevent injection
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Anchor styling for links that leave the app. */
const EXTERNAL_LINK_CLASS = 'text-blue-600 dark:text-blue-400 hover:underline'

/**
 * Private-use codepoints standing in for an Astrid reference while `marked`
 * runs. They have to survive the parser untouched: `marked` escapes
 * `& < > " '` and leaves everything else alone, and no one types U+E000.
 *
 * A word-like token (`ASTRIDREF0`) would be corrupted by any construct that
 * transforms its text, and could collide with real content.
 */
const REF_OPEN = '\uE000'
const REF_CLOSE = '\uE001'

/**
 * Astrid's three reference forms, in the order they must be extracted.
 *
 * These are NOT standard markdown and must never reach `marked`:
 * `![Title](taskId)` is markdown IMAGE syntax, so the parser turns a task
 * reference into `<img src="taskId">`. `@[…]` and `#[…]` degrade more quietly,
 * into a stray `@`/`#` followed by a link to a raw id.
 */
const REFERENCE_RULES: Array<{
  pattern: RegExp
  render: (label: string, id: string) => string
}> = [
  {
    // @[Name](userId) — links to the user profile
    pattern: /@\[([^\]]+)\]\(([^)]+)\)/g,
    render: (name, userId) =>
      `<a href="/u/${encodeURIComponent(userId)}" class="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1 rounded font-medium no-underline hover:underline">@${escapeHtml(name)}</a>`,
  },
  {
    // #[ListName](listId) — links to the list view
    pattern: /#\[([^\]]+)\]\(([^)]+)\)/g,
    render: (name, listId) =>
      `<a href="/lists/${encodeURIComponent(listId)}" class="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1 rounded font-medium no-underline hover:underline">#${escapeHtml(name)}</a>`,
  },
  {
    // ![TaskTitle](taskId) — links to the task detail
    pattern: /!\[([^\]]+)\]\(([^)]+)\)/g,
    render: (title, taskId) =>
      `<a href="/?task=${encodeURIComponent(taskId)}" class="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1 rounded font-medium no-underline hover:underline">!${escapeHtml(title)}</a>`,
  },
]

/** Swap Astrid references out for sentinels, keeping the rendered HTML aside. */
function extractReferences(text: string): { text: string; rendered: string[] } {
  const rendered: string[] = []

  const withSentinels = REFERENCE_RULES.reduce(
    (acc, rule) =>
      acc.replace(rule.pattern, (_match, label: string, id: string) => {
        rendered.push(rule.render(label, id))
        return `${REF_OPEN}${rendered.length - 1}${REF_CLOSE}`
      }),
    text
  )

  return { text: withSentinels, rendered }
}

/** Put the reference pills back once markdown rendering is done. */
function restoreReferences(html: string, rendered: string[]): string {
  if (rendered.length === 0) return html
  return html.replace(
    new RegExp(`${REF_OPEN}(\\d+)${REF_CLOSE}`, 'g'),
    (match, index: string) => rendered[Number(index)] ?? match
  )
}

/**
 * Give anchors that leave the app a new tab and the link styling.
 *
 * Runs on `marked`'s output only — reference pills are injected afterwards, so
 * they keep their own classes and stay in-tab, which is what they should do:
 * they point at other pages of this app.
 */
function decorateExternalLinks(html: string): string {
  return html.replace(/<a href="([^"]*)"([^>]*)>/g, (match, href: string, rest: string) => {
    // GFM autolinks a bare `www.` host with an http:// scheme. The old
    // hand-rolled linkifier upgraded these to https; keep that.
    const target = /^http:\/\/www\./i.test(href)
      ? href.replace(/^http:\/\//i, 'https://')
      : href

    // Leave relative/in-app hrefs alone — only outbound links get a new tab.
    if (!/^(https?:|mailto:)/i.test(target)) return match
    if (!isSafeUrl(target)) return '<a>'

    return `<a href="${target}"${rest} target="_blank" rel="noopener noreferrer" class="${EXTERNAL_LINK_CLASS}">`
  })
}

// Configure marked for secure rendering
marked.setOptions({
  gfm: true,       // GitHub Flavored Markdown (tables, strikethrough, etc.)
  breaks: true,    // Convert \n to <br>
})

/**
 * Securely render markdown text to HTML using the `marked` library
 * Supports all standard markdown: headings, lists, tables, code blocks, links, etc.
 * Uses DOMPurify to prevent XSS attacks
 */
export function renderMarkdown(text: string): string {
  if (!text) return ""

  const html = marked.parse(text, { async: false }) as string

  // Sanitize the HTML to prevent XSS
  // DOMPurify's defaults already block scripts, event handlers, and iframes
  // while allowing standard HTML elements (headings, lists, tables, links, etc.)
  if (typeof window !== 'undefined') {
    return DOMPurify.sanitize(html)
  }

  // For server-side rendering, strip dangerous content
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*on\w+\s*=/gi, '<')
    .replace(/<iframe[^>]*>/gi, '')
}

/**
 * Tags the reference-aware renderer emits. This is the full GFM set agreed for
 * task descriptions, comments and chat (task 0a54e46f) — the same constructs
 * `renderMarkdown` already gave the editor preview.
 *
 * Keep this in step with what `marked` produces. A construct missing here
 * parses correctly and is then STRIPPED, so the symptom is "the fix did
 * nothing" rather than an error.
 */
const RICH_TEXT_TAGS = [
  'p', 'br', 'span',
  'strong', 'em', 'del', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a',
  'input', // GFM task list checkboxes
]

/** `type`/`checked`/`disabled` are for checkboxes; `align` for table cells. */
const RICH_TEXT_ATTRS = ['href', 'target', 'rel', 'class', 'type', 'checked', 'disabled', 'align']

/** Marker standing in for a fenced code block's `<code>` while inline ones are styled. */
const PRE_CODE_SENTINEL = '\uE002'

/**
 * Apply the caller's inline-code class without touching fenced code blocks.
 *
 * `codeClass` is a chip style (`px-1 rounded`) meant for inline `` `code` ``.
 * Putting it on the `<code>` inside a `<pre>` would draw a chip around a whole
 * block, so fenced blocks are masked out first.
 */
function styleInlineCode(html: string, codeClass: string): string {
  if (!codeClass) return html
  return html
    .replace(/<pre><code/g, `<pre>${PRE_CODE_SENTINEL}`)
    .replace(/<code>/g, `<code class="${codeClass}">`)
    .replace(new RegExp(PRE_CODE_SENTINEL, 'g'), '<code')
}

/**
 * Render markdown for task descriptions, comments and chat messages.
 *
 * Full GFM via `marked`, plus Astrid's three reference forms. The references
 * are extracted to sentinels BEFORE parsing and re-injected after: they are not
 * markdown, and `![Title](taskId)` in particular is image syntax that `marked`
 * would render as `<img src="taskId">`.
 */
export function renderMarkdownWithLinks(text: string, options?: { codeClass?: string }): string {
  if (!text) return ""

  const { text: withSentinels, rendered } = extractReferences(text)

  let html = marked.parse(withSentinels, { async: false }) as string
  html = decorateExternalLinks(html)
  html = styleInlineCode(html, options?.codeClass || '')
  html = restoreReferences(html, rendered)

  // Sanitize the HTML to prevent XSS.
  //
  // ALLOW_UNKNOWN_PROTOCOLS is deliberately NOT set. It was safe while every
  // href here was generated in-house, but `marked` now builds anchors out of
  // user text, and the flag would let `javascript:` through. Relative hrefs
  // like /u/<id> are permitted by DOMPurify's defaults regardless.
  if (typeof window !== 'undefined') {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: RICH_TEXT_TAGS,
      ALLOWED_ATTR: RICH_TEXT_ATTRS,
    })
  }

  // For server-side rendering, strip dangerous content
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*on\w+\s*=/gi, '<')
    .replace(/<iframe[^>]*>/gi, '')
}

/**
 * Sanitize plain text for safe HTML display (newlines to <br> only)
 */
export function sanitizeTextToHtml(text: string): string {
  if (!text) return ""

  // Escape HTML first, then convert newlines
  let html = escapeHtml(text).replace(/\n/g, "<br>")

  if (typeof window !== 'undefined') {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['br'],
      ALLOWED_ATTR: []
    })
  }

  return html
}