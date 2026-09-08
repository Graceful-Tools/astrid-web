import type { ApiBoundaryExemption } from '@/lib/api-boundary-guard'

/**
 * New raw internal calls and duplicate legacy/v1 route implementations are
 * blocked by default. Add the narrowest possible entry here only when protocol
 * behavior (streaming, conditional requests, or an externally pinned contract)
 * cannot use the canonical client, and explain why.
 *
 * The ListImageClaimError entry that used to sit here is gone: the guard now
 * recognises a message narrowed to an app-defined error class as legitimate on
 * its own (lib/api-boundary-guard.ts, TYPED_ERROR_NARROWING). It was an
 * exemption for writing the CORRECT code, and a list where the right answer
 * needs an exemption is a list nobody reads (task 17fea642).
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
