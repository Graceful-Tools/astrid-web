import { useEffect, useState } from 'react'
import { apiGet } from '@/lib/api'

const SEARCH_DEBOUNCE_MS = 300
const SEARCH_PAGE_SIZE = 100

interface SearchTask {
  id: string
}

interface SearchResponse {
  tasks: SearchTask[]
  nextCursor: string | null
}

function isSearchResponse(value: unknown): value is SearchResponse {
  if (!value || typeof value !== 'object') return false

  const response = value as Record<string, unknown>
  return (
    Array.isArray(response.tasks) &&
    response.tasks.every(task => (
      !!task &&
      typeof task === 'object' &&
      typeof (task as Record<string, unknown>).id === 'string'
    )) &&
    (response.nextCursor === null || typeof response.nextCursor === 'string')
  )
}

async function fetchAllSearchTaskIds(query: string, signal: AbortSignal): Promise<string[]> {
  const taskIds: string[] = []
  const seenCursors = new Set<string>()
  let cursor: string | null = null

  do {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    const response = await apiGet(
      `/api/v1/search?q=${encodeURIComponent(query)}&limit=${SEARCH_PAGE_SIZE}${cursorParam}`,
      { signal },
    )
    const body: unknown = await response.json()

    if (!isSearchResponse(body)) {
      throw new Error('Invalid task search response')
    }

    taskIds.push(...body.tasks.map(task => task.id))
    cursor = body.nextCursor

    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error('Task search returned a repeated cursor')
      }
      seenCursors.add(cursor)
    }
  } while (cursor)

  return taskIds
}

export function useTaskSearch(query: string, debounceMs = SEARCH_DEBOUNCE_MS) {
  const [taskIds, setTaskIds] = useState<string[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const normalizedQuery = query.trim()

    if (!normalizedQuery) {
      setTaskIds([])
      setIsSearching(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setTaskIds([])
    setIsSearching(true)
    setError(null)

    const timeoutId = window.setTimeout(async () => {
      try {
        const nextTaskIds = await fetchAllSearchTaskIds(normalizedQuery, controller.signal)
        if (!controller.signal.aborted) {
          setTaskIds(nextTaskIds)
        }
      } catch (searchError) {
        if (!controller.signal.aborted) {
          const error = searchError instanceof Error
            ? searchError
            : new Error('Unknown task search error')
          console.error('[useTaskSearch] Search failed:', error)
          setTaskIds([])
          setError(error)
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false)
        }
      }
    }, debounceMs)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [debounceMs, query])

  return { taskIds, isSearching, error }
}
