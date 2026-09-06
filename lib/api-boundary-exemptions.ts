import type { ApiBoundaryExemption } from '@/lib/api-boundary-guard'

/**
 * New raw internal calls and duplicate legacy/v1 route implementations are
 * blocked by default. Add the narrowest possible entry here only when protocol
 * behavior (streaming, conditional requests, or an externally pinned contract)
 * cannot use the canonical client, and explain why.
 */
export const API_BOUNDARY_EXEMPTIONS: readonly ApiBoundaryExemption[] = [
  {
    kind: 'raw-internal-call',
    file: 'hooks/use-webauthn.ts',
    contains: '/api/auth/webauthn/',
    reason:
      'The WebAuthn ceremony is a fixed four-call protocol (options → browser ' +
      'ceremony → verify) whose steps must run exactly once, in order, against a ' +
      'live connection. lib/api.ts is the offline-aware client: it can queue, ' +
      'replay and cache-invalidate, all of which are wrong for a single-use ' +
      'challenge. These calls pre-date this guard and were only re-flagged when ' +
      'task c2fbe8e4 moved the existing-account switch from the options step to ' +
      'the verify step to close an enumeration oracle.',
  },
]
