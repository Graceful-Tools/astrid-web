// Side-effect CSS imports (`import '../globals.css'`) need a declaration under
// TypeScript 6, which added TS2882 for side-effect imports of modules it has no
// types for. Under TS 5 these resolved silently; the import itself is unchanged
// and is handled by the bundler, not the type checker.
declare module '*.css';
