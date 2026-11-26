/**
 * astrid-core's optional preset columns as data: Testing (R7, Jon 2026-11-12), "Deploying, in
 * canary, or in an experiment", and Pending results (ADEV-274, ADEV-279), "waiting for an
 * experiment or a verification to report". Neither is a default column; a board adds one from
 * Manage statuses, with its FIXED role. **Nothing else adds one**: not a gate, a connector, an
 * experiment link or an agent (Jon, 2026-11-25).
 *
 * Its own tiny module so the board's labels, the status panel and the role check can read it
 * without pulling the Waiting rules into every page's first load (the AWTD-1593 budget). On the
 * server, which presets a board may still add is asked of the core (lib/waiting-rules.ts
 * `boardPresets`); {@link availableBoardPresets} is the same rule, and the parity test pins both.
 *
 * Which presets a board is *offered* is narrower than which it may hold: {@link offerableBoardPresets}
 * drops Pending results while goal signals are off for the board's project, because a column whose
 * rules refuse every entry (it needs an experiment or a verification) helps nobody. The core's list
 * stays whole, so the parity test is about the core's rule and the gate is a separate, tested filter.
 */

/** R7's fixed role. Not minted (`custom-…`) so the deploy check finds it on any board. */
export const TESTING_STATUS_ROLE = 'testing'

/** The Pending results lane's fixed role (core `RESULTS_STATUS_ROLE`). */
export const RESULTS_STATUS_ROLE = 'results'

export interface BoardPreset {
  role: string
  name: string
  description: string
}

/** In the core's order. */
export const BOARD_PRESETS: readonly BoardPreset[] = [
  { role: TESTING_STATUS_ROLE, name: 'Testing', description: 'Deploying, in canary, or in an experiment.' },
  {
    role: RESULTS_STATUS_ROLE,
    name: 'Pending results',
    description: 'Built and released; waiting for an experiment or a verification to report.',
  },
]

/** Presets that only make sense while goal signals are on for the board's project. */
export const GOAL_SIGNALS_PRESET_ROLES: readonly string[] = [RESULTS_STATUS_ROLE]

/** The presets a board can still add: not one it holds by role, nor by (case-insensitive) name. */
export function availableBoardPresets(customStates: unknown): BoardPreset[] {
  const states = Array.isArray(customStates) ? customStates : []
  const held = states
    .filter((state): state is Record<string, unknown> => Boolean(state) && typeof state === 'object')
    .map(state => ({
      role: typeof state.role === 'string' ? state.role : '',
      name: typeof state.name === 'string' ? state.name.toLowerCase() : '',
    }))
  return BOARD_PRESETS.filter(
    preset => !held.some(state => state.role === preset.role || state.name === preset.name.toLowerCase()),
  ).map(preset => ({ ...preset }))
}

/** The presets to show, from any list of them (the core's, or the TypeScript): the gate's filter. */
export function offerableBoardPresets<T extends { role: string }>(presets: readonly T[], goalSignalsOn: boolean): T[] {
  return presets.filter(preset => goalSignalsOn || !GOAL_SIGNALS_PRESET_ROLES.includes(preset.role))
}
