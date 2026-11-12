"use client"

/**
 * Global listener for coding workflow management.
 * Handles SSE events and workflow orchestration; renders nothing.
 *
 * It used to be a pass-through provider wrapping the whole tree. It provided no context,
 * so it is now mounted beside the tree and loaded after hydration (components/providers.tsx,
 * AWTD-1604), which keeps the SSE manager out of every page's first-load JS.
 */

import { useCodingWorkflow } from '@/hooks/use-coding-workflow'

export function CodingWorkflowListener() {
  // The hook handles auth internally: it subscribes only when the session is authenticated.
  useCodingWorkflow()
  return null
}
