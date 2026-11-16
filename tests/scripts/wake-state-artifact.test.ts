/**
 * ADEV-26: a run is N workers, each uploading `agent-run-<harness>-<run id>-slot-<n>`. Only
 * slot 1 keeps wake state, so only its artifact (or a pre-ADEV-26 one) is restored.
 */
import { describe, expect, it } from 'vitest'
import { isRetainedWakeStateArtifact } from '@/scripts/lib/wake-state-artifact'

describe('ADEV-26: which artifact carries wake state', () => {
  it.each([
    ['agent-run-claude-code-100-slot-1', true],
    ['agent-run-claude-code-100', true],
    ['agent-run-claude-code-100-slot-2', false],
    ['agent-run-claude-code-200-slot-1', false],
    ['agent-run-claude-code-200', false],
    ['agent-run-codex-100-slot-1', false],
    ['agent-verdict-claude-code-100-slot-1', false],
    ['agent-run-claude-code-100-slot-1-extra', false],
  ])('ADEV-26: %s → %s (this run is 200)', (name, expected) => {
    expect(isRetainedWakeStateArtifact(name, 'claude-code', '200')).toBe(expected)
  })

  it('ADEV-26: a run id that is a prefix of another is not this run', () => {
    expect(isRetainedWakeStateArtifact('agent-run-claude-code-2001-slot-1', 'claude-code', '200')).toBe(true)
  })
})
