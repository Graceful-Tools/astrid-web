/**
 * astrid-core's optional preset columns (R7, Jon 2026-11-12) as data: the first is Testing,
 * "Deploying, in canary, or in an experiment." Not a default column; a board adds it from Manage
 * statuses, with its FIXED role.
 *
 * Its own tiny module so the board's labels, the status panel and the role check can read it
 * without pulling the Waiting rules into every page's first load (the AWTD-1593 budget). On the
 * server, which presets a board may still add is asked of the core (lib/waiting-rules.ts
 * `boardPresets`); {@link availableBoardPresets} is the same rule, and the parity test pins both.
 */

/** R7's fixed role. Not minted (`custom-…`) so the deploy check finds it on any board. */
export const TESTING_STATUS_ROLE = 'testing'

export interface BoardPreset {
  role: string
  name: string
  description: string
}

/** In the core's order. */
export const BOARD_PRESETS: readonly BoardPreset[] = [
  { role: TESTING_STATUS_ROLE, name: 'Testing', description: 'Deploying, in canary, or in an experiment.' },
]

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
