import { redirect } from "next/navigation"
import { getUnifiedSession } from "@/lib/session-utils"
import { DebugRemindersClient } from "./debug-reminders-client"

export default async function DebugRemindersPage() {
  const session = await getUnifiedSession()

  // Require authentication
  if (!session?.user?.id) {
    redirect("/auth/signin?callbackUrl=/debug-reminders")
  }

  // Pass the authenticated user's email to the client component
  const userEmail = session.user.email || ""

  return <DebugRemindersClient defaultUserEmail={userEmail} />
}
