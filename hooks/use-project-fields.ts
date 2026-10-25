"use client"

import { useEffect, useState } from 'react'
import type { ProjectFieldSchemaEntry } from '@/lib/project-field-display'

/**
 * A GitHub board's field SCHEMA, fetched once per project (AWTD-1210, P6a-4).
 *
 * Spec §9.4.3 — *"Schema once per project."* The values live on each task as a
 * compact `{ fieldId: scalar }` map with no names or types in it, so this is
 * what makes those values legible, and fetching it per task would defeat the
 * point of keeping them compact.
 *
 * **Two layers of not-refetching, doing different jobs.** The route serves an
 * ETag with `Cache-Control: private, no-cache`, so the BROWSER revalidates and
 * gets a 304 — cheap, but still a round trip, and still one per caller. The
 * in-flight map below is what stops twenty open task panes on one board firing
 * twenty simultaneous requests before any of them has answered.
 *
 * Resolved schemas are cached for the page's life. A field added on GitHub
 * appears on the next load, which is the same freshness the ETag would give
 * after a revalidate, without a request per render.
 */

type Schema = ProjectFieldSchemaEntry[]

const resolved = new Map<string, Schema>()
const inFlight = new Map<string, Promise<Schema>>()

async function load(projectId: string): Promise<Schema> {
  const cached = resolved.get(projectId)
  if (cached) return cached

  const existing = inFlight.get(projectId)
  if (existing) return existing

  const request = (async () => {
    const response = await fetch(`/api/v1/projects/${projectId}/fields`)
    if (!response.ok) {
      // 404 is the ordinary answer on a deployment without the capability, and
      // for a board the caller cannot see. Neither is worth an error state: the
      // pane simply shows no project fields.
      return []
    }
    const body = (await response.json()) as { fields?: Schema }
    return body.fields ?? []
  })()
    .then(schema => {
      resolved.set(projectId, schema)
      return schema
    })
    .catch(() => [] as Schema)
    .finally(() => {
      inFlight.delete(projectId)
    })

  inFlight.set(projectId, request)
  return request
}

/** Exported for tests, which must not inherit another test's cache. */
export function clearProjectFieldCache(): void {
  resolved.clear()
  inFlight.clear()
}

export function useProjectFields(projectId: string | null | undefined): {
  fields: ProjectFieldSchemaEntry[]
  loading: boolean
} {
  const [fields, setFields] = useState<Schema>(() => (projectId ? (resolved.get(projectId) ?? []) : []))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!projectId) {
      setFields([])
      return
    }
    const cached = resolved.get(projectId)
    if (cached) {
      setFields(cached)
      return
    }
    let live = true
    setLoading(true)
    load(projectId)
      .then(schema => {
        if (live) setFields(schema)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [projectId])

  return { fields, loading }
}
