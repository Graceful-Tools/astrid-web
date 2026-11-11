import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"
import { MOTION_NAMES, tokenEasings, tokenOpacity, tokenScale, tokenSpacing } from "@/lib/design/tailwind-theme"

/**
 * tailwind-merge only knows Tailwind's own scales. The design-token utilities
 * (`opacity-disabled`, `duration-medium`, `ease-fast`, `scale-press`,
 * `w-leading-control`) are named steps it has never heard of, so without this a
 * caller's override of a primitive's class kept both classes and CSS order
 * decided which won (AWTD-1575). The names are read from the same table
 * Tailwind is configured from, so a new token is known here as soon as it exists.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      opacity: Object.keys(tokenOpacity),
      scale: Object.keys(tokenScale),
      spacing: Object.keys(tokenSpacing),
    },
    classGroups: {
      duration: [{ duration: [...MOTION_NAMES] }],
      ease: [{ ease: Object.keys(tokenEasings) }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Allowed URL protocols for links - prevents javascript: and data: injection
const SAFE_URL_PROTOCOLS = ['http:', 'https:', 'mailto:']

/**
 * Validate that a URL uses a safe protocol
 * Prevents javascript: and data: URL injection attacks
 */
function isSafeUrl(url: string): boolean {
  try {
    const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`
    const parsed = new URL(urlWithProtocol)
    return SAFE_URL_PROTOCOLS.includes(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtmlForLink(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Convert URLs and markdown links in text to clickable HTML links
 * Supports:
 * - Plain domains: example.com, google.com
 * - URLs with protocols: http://example.com, https://example.com
 * - www URLs: www.example.com
 * - Markdown links: [text](url)
 *
 * Security features:
 * - Validates URL protocols (only http, https, mailto allowed)
 * - Escapes HTML in URLs to prevent injection
 *
 * Uses a split-based approach to prevent double-linkification:
 * 1. Convert markdown links to HTML first
 * 2. Split by existing <a> tags
 * 3. Only linkify URLs in text portions (not inside already-generated links)
 *
 * @param text - The text containing potential URLs or markdown links
 * @returns HTML string with URLs and markdown links converted to <a> tags
 */
export function linkifyText(text: string): string {
  // First: Convert markdown-style links [text](url) to HTML
  const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g
  let result = text.replace(markdownLinkPattern, (_match, linkText, url) => {
    const href = url.startsWith('http') ? url : `https://${url}`

    // Validate URL protocol to prevent javascript: injection
    if (!isSafeUrl(href)) {
      return escapeHtmlForLink(linkText) // Return escaped plain text for unsafe URLs
    }

    return `<a href="${escapeHtmlForLink(href)}" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">${escapeHtmlForLink(linkText)}</a>`
  })

  // Then: Split by existing <a> tags to separate already-linked content from text
  const parts = result.split(/(<a[^>]*>.*?<\/a>)/g)

  // Enhanced URL pattern that matches:
  // - http(s):// URLs
  // - www. URLs
  // - Plain domains (example.com, google.com)
  const urlPattern = /(https?:\/\/[^\s<]+[^\s<.,;:!?'")\]}>]|(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s<]*)?[^\s<.,;:!?'")\]}>])/gi

  // Process each part: skip already-generated <a> tags, linkify URLs in text portions
  result = parts.map(part => {
    // If this part is already a link tag, don't process it
    if (part.startsWith('<a ')) {
      return part
    }

    // Otherwise, linkify URLs in this text portion
    return part.replace(urlPattern, (url) => {
      const href = url.startsWith('http') ? url : `https://${url}`

      // Validate URL protocol to prevent javascript: injection
      if (!isSafeUrl(href)) {
        return escapeHtmlForLink(url)
      }

      return `<a href="${escapeHtmlForLink(href)}" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">${escapeHtmlForLink(url)}</a>`
    })
  }).join('')

  return result
}
