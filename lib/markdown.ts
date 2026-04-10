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

/**
 * Safely linkify URLs in text with proper escaping and protocol validation
 * Supports: plain domains, http(s):// URLs, www. URLs, and markdown links
 */
function safeLinkify(text: string): string {
  // First: Convert markdown-style links [text](url) to HTML with validation
  const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g
  let result = text.replace(markdownLinkPattern, (_match, linkText, url) => {
    const href = url.startsWith('http') ? url : `https://${url}`
    // Validate URL protocol
    if (!isSafeUrl(href)) {
      return escapeHtml(linkText) // Just return escaped text if URL is unsafe
    }
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">${escapeHtml(linkText)}</a>`
  })

  // Split by existing <a> tags to avoid double-linkification
  const parts = result.split(/(<a[^>]*>.*?<\/a>)/g)

  // URL pattern for plain URLs
  const urlPattern = /(https?:\/\/[^\s<]+[^\s<.,;:!?'")\]}>]|(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s<]*)?[^\s<.,;:!?'")\]}>])/gi

  // Process each part: skip already-generated <a> tags, linkify URLs in text portions
  result = parts.map(part => {
    if (part.startsWith('<a ')) {
      return part
    }
    return part.replace(urlPattern, (url) => {
      const href = url.startsWith('http') ? url : `https://${url}`
      // Validate URL protocol
      if (!isSafeUrl(href)) {
        return escapeHtml(url)
      }
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">${escapeHtml(url)}</a>`
    })
  }).join('')

  return result
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
 * Securely render markdown-like text with linkified URLs
 * Includes link support with URL protocol validation
 */
export function renderMarkdownWithLinks(text: string, options?: { codeClass?: string }): string {
  if (!text) return ""

  const codeClass = options?.codeClass || ''

  // Process markdown BEFORE linkifying to avoid conflicts
  let html = text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, `<code${codeClass ? ` class="${codeClass}"` : ''}>$1</code>`)

  // Handle references BEFORE safeLinkify — otherwise safeLinkify's [text](url)
  // pattern consumes @[Name](id), #[Name](id), and ![Name](id)

  // Handle mentions @[Name](userId) — links to user profile
  html = html.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, (_match, name, userId) => {
    return `<a href="/u/${encodeURIComponent(userId)}" class="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1 rounded font-medium no-underline hover:underline">@${escapeHtml(name)}</a>`
  })

  // Handle list references #[ListName](listId) — links to list view
  html = html.replace(/#\[([^\]]+)\]\(([^)]+)\)/g, (_match, name, listId) => {
    return `<a href="/lists/${encodeURIComponent(listId)}" class="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1 rounded font-medium no-underline hover:underline">#${escapeHtml(name)}</a>`
  })

  // Handle task references ![TaskTitle](taskId) — links to task detail
  html = html.replace(/!\[([^\]]+)\]\(([^)]+)\)/g, (_match, title, taskId) => {
    return `<a href="/?task=${encodeURIComponent(taskId)}" class="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1 rounded font-medium no-underline hover:underline">!${escapeHtml(title)}</a>`
  })

  // Linkify URLs with safety validation (after references so it doesn't eat [Name](id))
  html = safeLinkify(html)

  // Convert newlines to <br>
  html = html.replace(/\n/g, "<br>")

  // Sanitize the HTML to prevent XSS
  if (typeof window !== 'undefined') {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['strong', 'em', 'code', 'br', 'a', 'span'],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
      // Allow relative URLs and standard protocols — we control all href generation
      ALLOW_UNKNOWN_PROTOCOLS: true,
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