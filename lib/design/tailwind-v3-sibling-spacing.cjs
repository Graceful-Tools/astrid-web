/**
 * PostCSS plugin that keeps Tailwind 3's `space-*` and `divide-*` behaviour on Tailwind 4 (ADEV-334).
 *
 * Tailwind 4 changed these utilities from
 *   .space-x-3 > :not([hidden]) ~ :not([hidden]) { margin-left: 12px }          (every child but the first)
 * to
 *   :where(.space-x-3 > :not(:last-child)) { margin-inline-end: 12px }          (every child but the last)
 *
 * About 140 components were laid out against the v3 rule. Under v4 the first child gets an end margin
 * that overrides its own classes; a `-m-2` hit-target wrapper, for example, moved every task row
 * 16px right. Rewriting the classes to `gap` would change block layouts, so this plugin turns the
 * emitted v4 rules back into the v3 selector and sides. It runs after `@tailwindcss/postcss`.
 */

/** v4 declaration → the v3 property carrying the same value (the value already encodes reverse). */
const SIDE_FOR = {
  'margin-inline-start': 'margin-right', // N * reverse
  'margin-inline-end': 'margin-left', // N * (1 - reverse)
  'margin-block-start': 'margin-bottom', // N * reverse
  'margin-block-end': 'margin-top', // N * (1 - reverse)
  'border-inline-start-width': 'border-right-width', // N * reverse
  'border-inline-end-width': 'border-left-width', // N * (1 - reverse)
  'border-top-width': 'border-bottom-width', // N * reverse
  'border-bottom-width': 'border-top-width', // N * (1 - reverse)
}

// Production builds minify Tailwind's output (`>:not(:last-child)`), so whitespace is optional.
const V4_SELECTOR = /^:where\((.+?)\s*>\s*:not\(:last-child\)\)$/
// A class token (possibly variant-prefixed, possibly negative) that starts with space- or divide-.
const SIBLING_UTILITY = /(?:^|[.:])-?(?:space|divide)-/
// `.task-row { @apply space-x-3 }` keeps its own class name, so recognise the utility by its variables too.
const SIBLING_VARIABLE = /--tw-(?:space|divide)-[xy]-reverse/

function rewriteSelector(selector, appliesSiblingUtility) {
  const match = V4_SELECTOR.exec(selector.trim())
  if (!match) return null
  if (!appliesSiblingUtility && !SIBLING_UTILITY.test(match[1].replace(/\\:/g, ':'))) return null
  return `${match[1]} > :not([hidden]) ~ :not([hidden])`
}

/** @type {import('postcss').PluginCreator<void>} */
const plugin = () => ({
  postcssPlugin: 'tailwind-v3-sibling-spacing',
  Rule(rule) {
    if (!rule.selector.includes(':not(:last-child)')) return
    let appliesSiblingUtility = false
    rule.walkDecls((decl) => {
      if (SIBLING_VARIABLE.test(decl.prop) || SIBLING_VARIABLE.test(decl.value)) appliesSiblingUtility = true
    })
    const selectors = rule.selectors.map((selector) => rewriteSelector(selector, appliesSiblingUtility))
    if (selectors.some((s) => s === null)) return
    rule.selectors = selectors
    rule.walkDecls((decl) => {
      const side = SIDE_FOR[decl.prop]
      if (side) decl.prop = side
    })
  },
})
plugin.postcss = true

module.exports = plugin
