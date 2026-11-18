import { useEffect } from 'react'
import { scheduleBrowserCoreRules } from '@/lib/core-rules/browser'

/** Load astrid-core's browser door once the page is idle after first paint (AWTD-1586). */
export function useBrowserCoreRules(): void {
  useEffect(() => scheduleBrowserCoreRules(), [])
}
