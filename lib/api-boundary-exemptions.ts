import type { ApiBoundaryExemption } from '@/lib/api-boundary-guard'

/**
 * New raw internal calls and duplicate legacy/v1 route implementations are
 * blocked by default. Add the narrowest possible entry here only when protocol
 * behavior (streaming, conditional requests, or an externally pinned contract)
 * cannot use the canonical client, and explain why.
 */
export const API_BOUNDARY_EXEMPTIONS: readonly ApiBoundaryExemption[] = []
