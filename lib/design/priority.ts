/**
 * The priority colours, from the design tokens.
 *
 * Priority has four values and one colour each, the same on every client
 * (docs/specs/DESIGN_SYSTEM.md). Web used to have three sets: the leading
 * control's amber, the picker's `yellow-500` and the header's `orange-500` all
 * meant "medium". This is the one home; the classes are in
 * styles/components.css.
 *
 * Low is the brand accent, as on iOS, so a partner's low priority is the
 * partner's colour. In Dark it is the accent's lighter shade: the accent
 * itself is 2.84:1 on a dark card (astrid-core register DS26).
 */
const NAMES = ['none', 'low', 'medium', 'high'] as const

export type PriorityTokenName = (typeof NAMES)[number]

/** 0-3 to the token's name. Anything else reads as no priority. */
export function priorityTokenName(priority: number): PriorityTokenName {
  return NAMES[priority] ?? 'none'
}

/** A CSS colour for a `style` prop: follows the theme and the brand. */
export function priorityColor(priority: number): string {
  return `rgb(var(--astrid-priority-${priorityTokenName(priority)}))`
}

/** Text in the priority's colour. */
export function priorityTextClass(priority: number): string {
  return `priority-text-${priorityTokenName(priority)}`
}

/** A filled control: background and border in the priority's colour. */
export function priorityFillClass(priority: number): string {
  return `priority-fill-${priorityTokenName(priority)}`
}

/** An outlined control: border and text in the priority's colour. */
export function priorityOutlineClass(priority: number): string {
  return `priority-outline-${priorityTokenName(priority)}`
}
