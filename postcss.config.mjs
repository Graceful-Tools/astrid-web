import siblingSpacing from './lib/design/tailwind-v3-sibling-spacing.cjs';

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: [
    '@tailwindcss/postcss',
    // ADEV-334: keep Tailwind 3's space-*/divide-* sibling rule (see the file). Must run after Tailwind.
    siblingSpacing,
  ],
};

export default config;
