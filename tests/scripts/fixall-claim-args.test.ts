/**
 * RED for AWTD-922: `--agent`'s value was being read as the comment watermark.
 *
 * `scripts/claim-fixall-task.ts` built its positionals by dropping anything that
 * started with `--` and keeping everything else:
 *
 *     process.argv.slice(2).filter(arg => !arg.startsWith("--"))
 *
 * That removes the FLAG and keeps its VALUE. So the invocation both
 * docs/FIXALL_WORKFLOW.md and .claude/commands/fixall.md prescribe —
 * `<id> ready --agent claude` — produced `commentWatermark: "claude"`, and the
 * server refused it with "Ready claims must not include a comment watermark".
 * Every local harness claim failed; only the CI path worked, because
 * .github/workflows/fixall.yml passes three positionals and no flag.
 *
 * The parsing is extracted here rather than tested through the script because
 * the script's only other act is a network call, which is why a flag that never
 * worked shipped: there was nowhere to assert this without one.
 */

import { describe, it, expect } from 'vitest'
import { parseClaimArgs } from '../../scripts/lib/fixall-claim-args'

const TASK = '00000000-0000-4000-8000-000000000000'
const ISO = '2026-09-12T11:59:24.019Z'

describe('parseClaimArgs (AWTD-922)', () => {
  it('AWTD-922: a ready claim with --agent carries the agent and NO watermark', () => {
    // The exact documented form. Previously commentWatermark === 'claude'.
    expect(parseClaimArgs([TASK, 'ready', '--agent', 'claude'])).toEqual({
      taskId: TASK,
      action: 'ready',
      commentWatermark: null,
      agent: 'claude',
    })
  })

  it('AWTD-922: the flag value is never mistaken for a positional, whatever it is', () => {
    // 'codex' is also a plausible watermark-shaped string to leak through.
    expect(parseClaimArgs([TASK, 'ready', '--agent', 'codex']).commentWatermark).toBeNull()
  })

  it('keeps BOTH a real watermark and the agent, flag last', () => {
    expect(parseClaimArgs([TASK, 'recheck', ISO, '--agent', 'codex'])).toEqual({
      taskId: TASK,
      action: 'recheck',
      commentWatermark: ISO,
      agent: 'codex',
    })
  })

  it('keeps both regardless of flag position — order must not decide the outcome', () => {
    // The old parse was order-dependent: whichever non-flag token landed third won.
    expect(parseClaimArgs([TASK, '--agent', 'codex', 'recheck', ISO])).toEqual({
      taskId: TASK,
      action: 'recheck',
      commentWatermark: ISO,
      agent: 'codex',
    })
  })

  describe('the CI contract (.github/workflows/fixall.yml) is unchanged', () => {
    it('three positionals and no flag default the agent to copilot', () => {
      expect(parseClaimArgs([TASK, 'recheck', ISO])).toEqual({
        taskId: TASK,
        action: 'recheck',
        commentWatermark: ISO,
        agent: undefined,
      })
    })

    it('an empty-string watermark collapses to null', () => {
      // The workflow interpolates "${COMMENT_WATERMARK}" unconditionally, so a
      // ready action arrives with an empty third argument.
      expect(parseClaimArgs([TASK, 'ready', '']).commentWatermark).toBeNull()
    })
  })

  describe('bad input fails loudly rather than claiming as the wrong harness', () => {
    it('--agent with no value throws instead of silently defaulting to copilot', () => {
      // Falling back here would hand a Claude Code run's task to Copilot.
      expect(() => parseClaimArgs([TASK, 'ready', '--agent'])).toThrow(/--agent requires a value/)
    })

    it('--agent followed by another flag is a missing value, not a mailbox', () => {
      expect(() => parseClaimArgs([TASK, 'ready', '--agent', '--dry-run'])).toThrow(
        /--agent requires a value/,
      )
    })

    it('a missing task id or action throws', () => {
      expect(() => parseClaimArgs([TASK])).toThrow(/Usage/)
      expect(() => parseClaimArgs([])).toThrow(/Usage/)
    })
  })
})
