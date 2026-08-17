/**
 * Side-effect CSS imports (task bb1bc7f8).
 *
 * TypeScript 6 requires a module declaration for a side-effect import — the
 * `import '../globals.css'` form with no bindings. TS 5 resolved it silently,
 * so upgrading turned `app/[locale]/layout.tsx:10` into TS2882: "Cannot find
 * module or type declarations for side-effect import".
 *
 * Next.js supplies image and route types through next-env.d.ts, which is
 * generated and explicitly must not be edited, and it does not cover this. So
 * the declaration belongs here.
 *
 * `unknown` rather than a shape, deliberately: nothing should be READING from a
 * plain CSS import. A CSS *module* (`styles from './x.module.css'`) is a
 * different thing and is not declared here — if one is ever added, it wants its
 * own declaration returning a class-name record, and leaving this one narrow is
 * what forces that decision to be made rather than inherited.
 */
declare module '*.css' {
  const content: unknown
  export default content
}
