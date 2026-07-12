import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getUnifiedSession } from '@/lib/session-utils'
import { isAdmin } from '@/lib/admin-auth'
import { resolveAdminAccess } from '@/lib/admin-access'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getUnifiedSession()
  const hasAdminRecord = session?.user?.id ? await isAdmin(session.user.id) : false
  const decision = resolveAdminAccess(session, hasAdminRecord)
  if ('redirectTo' in decision) redirect(decision.redirectTo)
  return children
}
