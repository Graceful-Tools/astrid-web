"use client"

/**
 * The one Waiting prompt host (lib/waiting-prompt-bus.ts). components/providers.tsx loads it with
 * next/dynamic after hydration, so neither it nor the dialog costs a route any first-load
 * JavaScript (the AWTD-1593 budget); a request made before it arrives waits for it.
 * It also carries the Pending results picker host (ADEV-282), so that prompt adds no chunk of its own.
 */
import { useEffect, useState } from "react"
import { subscribeWaitingPrompt, type WaitingPromptRequest } from "@/lib/waiting-prompt-bus"
import WaitingConditionDialog from "@/components/WaitingConditionPrompt"
import { ResultsPromptHost } from "@/components/ResultsPromptHost"

export function WaitingPromptHost() {
  const [request, setRequest] = useState<WaitingPromptRequest | null>(null)
  useEffect(() => subscribeWaitingPrompt(setRequest), [])
  return (
    <>
      {/* Keyed by task, so a new request starts from a clean form. */}
      {request && <WaitingConditionDialog key={request.task.id} request={request} />}
      <ResultsPromptHost />
    </>
  )
}
