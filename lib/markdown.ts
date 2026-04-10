import DOMPurify from 'dompurify'

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

/**
 * Convert markdown table to HTML table
 */
function convertTable(lines: string[]): string {
  if (lines.length < 2) return lines.map(l => escapeHtml(l)).join('<br>')

  const parseRow = (line: string): string[] =>
    line.split('|').map(cell => cell.trim()).filter((_, i, arr) => i > 0 && i < arr.length)

  const headerCells = parseRow(lines[0])
  const rows = lines.slice(2) // skip header and separator

  let html = '<table class="border-collapse text-sm w-full my-2"><thead><tr>'
  for (const cell of headerCells) {
    html += `<th class="border border-gray-300 dark:border-gray-600 px-2 py-1 text-left font-semibold">${convertInlineMarkdown(cell)}</th>`
  }
  html += '</tr></thead><tbody>'
  for (const row of rows) {
    const cells = parseRow(row)
    html += '<tr>'
    for (const cell of cells) {
      html += `<td class="border border-gray-300 dark:border-gray-600 px-2 py-1">${convertInlineMarkdown(cell)}</td>`
    }
    html += '</tr>'
  }
  html += '</tbody></table>'
  return html
}

/**
 * Convert inline markdown (bold, italic, code) without block-level processing
 */
function convertInlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded text-sm">$1</code>')
}

/**
 * Securely render markdown text to HTML
 * Supports: headings, bold, italic, inline code, code blocks, lists, tables, and line breaks
 * Uses DOMPurify to prevent XSS attacks
 */
export function renderMarkdown(text: string): string {
  if (!text) return ""

  const lines = text.split('\n')
  const outputLines: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code blocks
    if (line.trimStart().startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(escapeHtml(lines[i]))
        i++
      }
      i++ // skip closing ```
      outputLines.push(`<pre class="bg-gray-100 dark:bg-gray-800 rounded p-2 my-1 overflow-x-auto text-sm"><code>${codeLines.join('\n')}</code></pre>`)
      continue
    }

    // Tables (line starts with |, next line is separator)
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const tableLines: string[] = [line]
      i++
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      outputLines.push(convertTable(tableLines))
      continue
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const sizes = ['text-xl font-bold', 'text-lg font-bold', 'text-base font-semibold', 'text-sm font-semibold', 'text-sm font-medium', 'text-xs font-medium']
      outputLines.push(`<h${level} class="${sizes[level - 1]} mt-3 mb-1">${convertInlineMarkdown(headingMatch[2])}</h${level}>`)
      i++
      continue
    }

    // Unordered list items
    if (/^\s*[-*]\s+/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        listItems.push(`<li>${convertInlineMarkdown(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`)
        i++
      }
      outputLines.push(`<ul class="list-disc pl-5 my-1 space-y-0.5">${listItems.join('')}</ul>`)
      continue
    }

    // Ordered list items
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        listItems.push(`<li>${convertInlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`)
        i++
      }
      outputLines.push(`<ol class="list-decimal pl-5 my-1 space-y-0.5">${listItems.join('')}</ol>`)
      continue
    }

    // Empty lines
    if (line.trim() === '') {
      outputLines.push('')
      i++
      continue
    }

    // Regular paragraph with inline markdown
    outputLines.push(convertInlineMarkdown(line))
    i++
  }

  // Join with <br> for non-empty adjacent lines, preserve spacing for empty lines
  let html = ''
  for (let j = 0; j < outputLines.length; j++) {
    const curr = outputLines[j]
    if (curr === '') {
      html += '<br>'
    } else {
      html += curr
      // Add <br> between consecutive inline text lines (not after block elements)
      if (j + 1 < outputLines.length && outputLines[j + 1] !== '' &&
          !curr.startsWith('<h') && !curr.startsWith('<ul') && !curr.startsWith('<ol') &&
          !curr.startsWith('<pre') && !curr.startsWith('<table') &&
          !outputLines[j + 1].startsWith('<h') && !outputLines[j + 1].startsWith('<ul') &&
          !outputLines[j + 1].startsWith('<ol') && !outputLines[j + 1].startsWith('<pre') &&
          !outputLines[j + 1].startsWith('<table')) {
        html += '<br>'
      }
    }
  }

  // Sanitize the HTML to prevent XSS
  if (typeof window !== 'undefined') {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['strong', 'em', 'code', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
      ALLOWED_ATTR: ['class']
    })
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