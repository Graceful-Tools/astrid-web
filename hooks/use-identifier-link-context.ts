"use client"

/**
 * What the autolinker needs to know about the reader (AWTD-1017, spec §5):
 * the project keys they can see — only those link, so `UTF-8` and `COVID-19`
 * stay prose — and the key of the project this text belongs to, which is what
 * lets `#12` mean `AWTD-12` inside that project's tasks and chat.
 *
 * Keys come from `/api/v1/projects`, read once per page load and shared by
 * every caller; a project created since then links after a reload. A failed
 * read is retried by the next caller to mount.
 *
 * Undefined until the read lands, and when the reader has no projects: the
 * renderer then links nothing, exactly as before task ids existed.
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchProjects, type ClientProject } from '@/lib/client-projects'
import type { IdentifierLinkContext } from '@/lib/task-identifier-links'

let projects: ClientProject[] | null = null
let inflight: Promise<ClientProject[]> | null = null

function loadProjects(): Promise<ClientProject[]> {
  if (projects) return Promise.resolve(projects)
  if (!inflight) {
    inflight = fetchProjects()
      .then(result => {
        projects = result
        return result
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

function projectFor(all: ClientProject[], listIds: string[]): ClientProject | undefined {
  const ids = new Set(listIds)
  return all.find(project => (project.lists ?? []).some(list => ids.has(list.id)))
}

export function useIdentifierLinkContext(listIds: string[]): IdentifierLinkContext | undefined {
  const [loaded, setLoaded] = useState<ClientProject[] | null>(projects)
  const listKey = listIds.join(',')

  useEffect(() => {
    let active = true
    loadProjects()
      .then(result => {
        if (active) setLoaded(result)
      })
      .catch(() => {
        // Links are an enhancement; a failed read leaves plain text.
      })
    return () => {
      active = false
    }
  }, [])

  return useMemo(() => {
    if (!loaded) return undefined
    // A renamed project's old keys link too: `/t/OLD-12` resolves through the
    // alias (AWTD-1024).
    const keys = loaded
      .flatMap(project => [project.key, ...(project.keyAliases ?? []).map(alias => alias.key)])
      .filter((key): key is string => Boolean(key))
    if (keys.length === 0) return undefined
    const ids = listKey ? listKey.split(',') : []
    return { keys, projectKey: projectFor(loaded, ids)?.key ?? null }
  }, [loaded, listKey])
}

/** Test seam: the module-level cache would otherwise leak between cases. */
export function __clearIdentifierLinkContextCache() {
  projects = null
  inflight = null
}
