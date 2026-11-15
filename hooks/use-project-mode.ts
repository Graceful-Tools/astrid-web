"use client"

/**
 * Can the signed-in person use Project Mode here? The client half of
 * `canUseProjectMode` (lib/project-mode.ts): the deployment must ship it
 * (`CAPABILITIES.projectMode`) AND the person must have the `project_mode`
 * flag — an admin grant from astrid.cc/admin or the code allowlist
 * (lib/project-mode-allowlist.ts). The server enforces the same pair on every
 * project route; this only decides what to draw (AWTD-1660).
 */
import { CAPABILITIES } from '@/lib/brand/capabilities'
import { useFeatureFlags } from '@/contexts/feature-flag-context'
import { PROJECT_MODE_FEATURE_KEY } from '@/lib/project-mode-shared'

export function useProjectMode(): boolean {
  const { isEnabled } = useFeatureFlags()
  return CAPABILITIES.projectMode && isEnabled(PROJECT_MODE_FEATURE_KEY)
}
