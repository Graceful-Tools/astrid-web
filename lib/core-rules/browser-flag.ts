/**
 * NEXT_PUBLIC_ASTRID_CORE_RULES_BROWSER: whether the browser loads astrid-core's rules door
 * (AWTD-1586) and the page's CSP allows it to compile WebAssembly (lib/csp.ts).
 *
 * Default ON since ADEV-304: list permissions have no TypeScript rule any more, so a browser
 * without the door refuses every permission check. "off" is still honoured (the app is then drawn
 * read-only, with a notice). Production has run it "on" since ADEV-90.
 *
 * Its own module, importing nothing, because lib/csp.ts is part of the edge middleware's graph.
 * Read literally so Next can inline the NEXT_PUBLIC_ value (lib/env.ts).
 */
export function browserCoreRulesFlagOn(value: string | undefined = process.env.NEXT_PUBLIC_ASTRID_CORE_RULES_BROWSER): boolean {
  return value !== 'off'
}
