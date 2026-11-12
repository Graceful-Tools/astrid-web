"use client"

/**
 * The one Waiting prompt host (lib/waiting-prompt.ts), mounted in components/providers.tsx.
 *
 * Kept tiny on purpose: it only subscribes. The dialog (Radix, the task search, the checkbox) is
 * loaded with next/dynamic the first time a move into Waiting asks for it, so it costs no route
 * any first-load JavaScript (the AWTD-1593 budget).
 */
import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { subscribeWaitingPrompt, type WaitingPromptRequest } from "@/lib/waiting-prompt"

const WaitingConditionDialog = dynamic(() => import("@/components/WaitingConditionPrompt"), { ssr: false })

export function WaitingPromptHost() {
  const [request, setRequest] = useState<WaitingPromptRequest | null>(null)
  useEffect(() => subscribeWaitingPrompt(setRequest), [])
  if (!request) return null
  // Keyed by task, so a new request starts from a clean form.
  return <WaitingConditionDialog key={request.task.id} request={request} />
}
