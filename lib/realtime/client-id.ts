/**
 * Which open app made a change (AWTD-1497).
 *
 * Edits and completions reach the actor's OTHER devices and tabs live, but
 * never the one that made them: an echo to that connection, mid-way through a
 * run of quick toggles, can make a checkbox appear to spring back (the
 * 2026-09-08 storm, task 8ef93fb9).
 *
 * So each running client picks an id, sends it with its writes in
 * CLIENT_ID_HEADER and on its live-stream URL as `?clientId=`. The server tags
 * the resulting event with it, and each stream connection drops events tagged
 * with its own id.
 *
 * A write that carries no id (an older iOS build, a script, an agent) keeps the
 * previous rule: the actor hears nothing. Nothing echoes to a client that has
 * not opted in.
 */

export const CLIENT_ID_HEADER = 'x-astrid-client-id'
export const CLIENT_ID_QUERY_PARAM = 'clientId'

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/** A well-formed client id, or null. Anything else is ignored, never trusted. */
export function parseClientId(value: string | null | undefined): string | null {
  if (!value) return null
  return CLIENT_ID_PATTERN.test(value) ? value : null
}

/** The client id a write request was sent with, if any. */
export function clientIdFromRequest(request: { headers: { get(name: string): string | null } }): string | null {
  return parseClientId(request.headers.get(CLIENT_ID_HEADER))
}

let browserId: string | null = null

/**
 * This page load's id: one per tab, new on reload. Kept in memory rather than
 * sessionStorage, because a duplicated tab copies sessionStorage and two tabs
 * sharing an id would each miss the other's edits.
 */
export function browserClientId(): string {
  if (!browserId) {
    const random =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    browserId = `web_${random}`.slice(0, 64)
  }
  return browserId
}
