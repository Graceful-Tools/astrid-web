import siblingSpacing from './lib/design/tailwind-v3-sibling-spacing.mjs';

/**
 * Turbopack bundles this file, so Tailwind is named (it loads native addons that cannot be
 * bundled) and the local plugin is imported (a relative name does not resolve from the bundle).
 * @type {import('postcss-load-config').Config}
 */
const config = {
  plugins: [
    '@tailwindcss/postcss',
    // ADEV-334: keep Tailwind 3's space-*/divide-* sibling rule (see the file). Must run after Tailwind.
    siblingSpacing,
  ],
};

export default config;
