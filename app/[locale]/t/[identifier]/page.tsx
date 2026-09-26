import { notFound, redirect } from 'next/navigation'
import { getUnifiedSession } from '@/lib/session-utils'
import { resolveTaskLink } from '@/lib/task-link'

export const dynamic = 'force-dynamic'

/**
 * `/t/AWTD-1007` — the target every autolinked task id points at (AWTD-1016).
 * Hidden and nonexistent tasks both land on the same not-found page.
 */
export default async function TaskIdentifierPage({
  params,
}: {
  params: Promise<{ identifier: string }>
}) {
  const { identifier } = await params
  const session = await getUnifiedSession()
  const target = await resolveTaskLink(identifier, session?.user?.id)

  if (target.kind === 'not-found') notFound()
  redirect(target.href)
}
