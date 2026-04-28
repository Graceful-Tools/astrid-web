import { createLogger } from '@/lib/logger'

const log = createLogger('safe-parse')

/**
 * Safe JSON Parsing Utilities
 *
 * Provides safe JSON parsing functions that handle edge cases gracefully:
 * - Empty strings
 * - Null/undefined values
 * - Malformed JSON
 * - Empty Response objects
 * - SSE event data
 *
 * All functions return a fallback value instead of throwing errors.
 */

/**
 * Safely parse a JSON string with a fallback value
 *
 * @param text - The string to parse (may be null, undefined, or empty)
 * @param fallback - Value to return if parsing fails
 * @returns Parsed object or fallback value
 *
 * @example
 * const data = safeJsonParse<User>('{"name":"John"}', null)
 * const empty = safeJsonParse<User>('', null) // Returns null, no error
 * const invalid = safeJsonParse<User>('invalid', null) // Returns null, no error
 */
export function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  // Handle null/undefined/empty strings
  if (!text || text.trim() === '') {
    return fallback
  }

  try {
    return JSON.parse(text) as T
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      textPreview: text.substring(0, 100)
    }, '❌ [SafeParse] Failed to parse JSON:')
    return fallback
  }
}

/**
 * Safely parse a Response object's JSON with a fallback value
 *
 * Checks content-length header before attempting to parse to avoid
 * "Unexpected end of JSON input" errors on empty responses.
 *
 * @param response - The Response object to parse
 * @param fallback - Value to return if parsing fails
 * @returns Parsed object or fallback value
 *
 * @example
 * const data = await safeResponseJson<Task>(response, null)
 * const empty = await safeResponseJson<Task>(emptyResponse, null) // Returns null, no error
 */
export async function safeResponseJson<T>(response: Response, fallback: null): Promise<T | null>
export async function safeResponseJson<T>(response: Response, fallback: T): Promise<T>
export async function safeResponseJson<T>(response: Response, fallback: T | null): Promise<T | null> {
  // Check content-length header
  const contentLength = response.headers.get('content-length')
  if (contentLength === '0') {
    log.warn('⚠️ [SafeParse] Response has content-length: 0, returning fallback')
    return fallback
  }

  // Check if response body is already consumed
  if (response.bodyUsed) {
    log.warn('⚠️ [SafeParse] Response body already consumed, returning fallback')
    return fallback
  }

  try {
    // Clone the response to avoid consuming the original
    const clonedResponse = response.clone()

    // Get text first to check if it's empty
    const text = await clonedResponse.text()

    if (!text || text.trim() === '') {
      log.warn('⚠️ [SafeParse] Response body is empty, returning fallback')
      return fallback
    }

    // Parse the text
    return JSON.parse(text) as T
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      status: response.status,
      statusText: response.statusText,
      url: response.url
    }, '❌ [SafeParse] Failed to parse Response JSON:')
    return fallback
  }
}

/**
 * Safely parse SSE (Server-Sent Events) event data with a fallback value
 *
 * @param eventData - The event.data string from MessageEvent
 * @param fallback - Value to return if parsing fails
 * @returns Parsed event object or fallback value
 *
 * @example
 * const event = safeEventParse<SSEEvent>(
 *   messageEvent.data,
 *   { type: 'error', timestamp: new Date().toISOString(), data: { error: 'Invalid event' } }
 * )
 */
export function safeEventParse<T>(eventData: string | null | undefined, fallback: T): T {
  if (!eventData || eventData.trim() === '') {
    log.warn('⚠️ [SafeParse] SSE event data is empty, returning fallback')
    return fallback
  }

  try {
    return JSON.parse(eventData) as T
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      eventDataPreview: eventData.substring(0, 100)
    }, '❌ [SafeParse] Failed to parse SSE event data:')
    return fallback
  }
}

/**
 * Validate that a parsed object has required fields
 *
 * @param obj - The object to validate
 * @param requiredFields - Array of required field names
 * @returns true if all required fields exist and are not null/undefined
 *
 * @example
 * const data = await safeResponseJson<Task>(response, null)
 * if (!data || !hasRequiredFields(data, ['id', 'title'])) {
 *   throw new Error('Invalid task response')
 * }
 */
export function hasRequiredFields<T extends object>(
  obj: T | null | undefined,
  requiredFields: (keyof T)[]
): obj is T {
  if (!obj) return false

  return requiredFields.every(field => {
    const value = obj[field]
    return value !== null && value !== undefined
  })
}
