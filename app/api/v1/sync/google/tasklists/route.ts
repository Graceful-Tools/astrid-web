import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { googleRequest, googleTokenFor } from '@/lib/sync/google'

/** GET — the caller's Google Tasks tasklists (remote containers). */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.sync.google', capability: 'syncGoogleTasks' },
  async (_req, auth) => {
    const token = await googleTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'Google not connected' }, { status: 401 })
    const { status, json } = await googleRequest(token, 'GET', '/users/@me/lists?maxResults=100')
    if (status !== 200) return NextResponse.json({ error: 'Google error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
    const tasklists = ((json.items as any[]) || []).map(l => ({ id: l.id, name: l.title }))
    // The default list's REAL id ("@default" is an API alias only) — clients
    // map it to Astrid's My Tasks (unlisted, assigned-to-me).
    let defaultId: string | null = null
    const def = await googleRequest(token, 'GET', '/users/@me/lists/@default')
    if (def.status === 200 && def.json?.id) defaultId = String(def.json.id)
    return NextResponse.json({ tasklists, defaultId })
  }
)

/** POST — create a Google tasklist (auto-link modes). Body: { title } */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.google', capability: 'syncGoogleTasks' },
  async (req, auth) => {
    const token = await googleTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'Google not connected' }, { status: 401 })
    const body = await req.json().catch(() => null)
    const title = (body?.title as string | undefined)?.trim()
    if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
    const { status, json } = await googleRequest(token, 'POST', '/users/@me/lists', { title })
    if (status !== 200) return NextResponse.json({ error: 'Google error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
    return NextResponse.json({ tasklist: { id: json.id, name: json.title } })
  }
)
