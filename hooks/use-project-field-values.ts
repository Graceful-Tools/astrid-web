"use client"

import { useEffect, useState } from 'react'

type FieldValues = Record<string, string | number>

/**
 * Every task's project field values on one GitHub board (AWTD-1259, P6a-5).
 *
 * The bulk task sync omits `fields` — they are opt-in on the list route for
 * the payload budget (AWTD-1208, §9.4.3) — so filtering the board by a field
 * needs them fetched separately. Only while a filter is active: pass `null`
 * and nothing is requested. `omit` keeps it to ids and values in practice;
 * `description` alone is most of a page.
 *
 * Returns `null` until the values arrive, so the caller can tell "not loaded"
 * from "no task has a value".
 */
export function useProjectFieldValues(boardListId: string | null): ReadonlyMap<string, FieldValues> | null {
  const [values, setValues] = useState<ReadonlyMap<string, FieldValues> | null>(null)

  useEffect(() => {
    setValues(null)
    if (!boardListId) return

    let live = true
    const params = new URLSearchParams({
      listId: boardListId,
      include: 'fields',
      omit: 'description,listMembers',
      limit: '1000',
    })
    fetch(`/api/v1/tasks?${params}`)
      .then(response => {
        if (!response.ok) throw new Error(`fields read ${response.status}`)
        return response.json()
      })
      .then((body: { tasks?: Array<{ id: string; fields?: FieldValues }> }) => {
        if (!live) return
        const map = new Map<string, FieldValues>()
        for (const task of body.tasks ?? []) {
          if (task.fields) map.set(task.id, task.fields)
        }
        setValues(map)
      })
      // A failed read stays null, so the board shows unfiltered rather than
      // empty — an empty board would read as "nothing matches".
      .catch(() => {})

    return () => {
      live = false
    }
  }, [boardListId])

  return values
}
