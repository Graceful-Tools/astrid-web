/**
 * Which files may import which vendor SDK (AWTD-1463).
 *
 * One code path, backend chosen by env — never a Vercel branch and an Azure
 * branch (docs/architecture/PLATFORM_ASSESSMENT_2026-11.md §5). That holds only
 * while each vendor's SDK is named in its driver files and nowhere else: one
 * `import { Redis } from '@upstash/redis'` in a route and astrid.cc and a
 * partner's Azure deployment run different code.
 *
 * Read by eslint.config.mjs (no-restricted-imports, the mechanism check:reuse
 * relies on) and by tests/rules/vendor-sdks-stay-in-their-drivers.test.ts,
 * which also catches the dynamic `import()` and `require()` ESLint's rule
 * cannot see. Tests are exempt: they mock vendors wherever they need to.
 *
 * Adding a vendor: add it here with its driver files. Widening a list is the
 * decision this file exists to make visible — a new entry belongs in a seam
 * (lib/storage/, lib/realtime/, lib/email-transport.ts, lib/jobs/), not in
 * the caller that wanted it.
 */

/** @type {Array<{ vendor: string, packages: string[], files: string[] }>} */
export const VENDOR_SDK_BOUNDARIES = [
  {
    vendor: 'Upstash Redis',
    packages: ['@upstash/*'],
    // lib/sse-utils.ts reads the event stream until the RealtimeBus seam
    // (lib/realtime/, PLATFORM_ASSESSMENT A2/W2) replaces it.
    files: ['lib/redis.ts', 'lib/realtime/**', 'lib/sse-utils.ts'],
  },
  {
    vendor: 'Vercel Blob',
    packages: ['@vercel/blob', '@vercel/blob/*'],
    files: ['lib/secure-storage.ts', 'lib/storage/**'],
  },
  {
    vendor: 'Azure',
    packages: ['@azure/*'],
    files: ['lib/storage/**'],
  },
  {
    vendor: 'aws4fetch (S3)',
    packages: ['aws4fetch', 'aws4fetch/*'],
    files: ['lib/storage/**'],
  },
  {
    vendor: 'Resend',
    packages: ['resend', 'resend/*'],
    // The script is a Resend diagnostic: testing the vendor is its job.
    files: ['lib/email-transport.ts', 'scripts/test-resend-setup.ts'],
  },
  {
    vendor: 'nodemailer (SMTP)',
    packages: ['nodemailer', 'nodemailer/*'],
    files: ['lib/email-transport.ts'],
  },
]

/** Not subject to the boundaries: tests mock and fixture vendors freely. */
export const VENDOR_SDK_EXEMPT = ['tests/**', 'e2e/**']

function restriction({ vendor, packages, files }) {
  return {
    group: packages,
    message:
      `${vendor} is a vendor SDK: import it only from ${files.join(', ')} ` +
      '(scripts/lib/vendor-sdk-boundaries.mjs, AWTD-1463). Go through that seam instead, ' +
      'so every deployment runs the same code with the backend chosen by env.',
  }
}

/**
 * Flat-config blocks: everything restricted everywhere, then each driver file
 * re-configured with only the vendors it may NOT use. A later block's rule
 * options replace an earlier one's, which is what makes the per-file
 * allowance work.
 */
export function vendorSdkEslintBlocks() {
  const lintable = ['**/*.{ts,tsx,js,jsx,mjs,cjs}']
  const allRestricted = VENDOR_SDK_BOUNDARIES.map(restriction)
  const blocks = [
    {
      files: lintable,
      ignores: VENDOR_SDK_EXEMPT,
      rules: { 'no-restricted-imports': ['error', { patterns: allRestricted }] },
    },
  ]
  const driverGlobs = [...new Set(VENDOR_SDK_BOUNDARIES.flatMap(b => b.files))]
  for (const glob of driverGlobs) {
    const stillRestricted = VENDOR_SDK_BOUNDARIES.filter(b => !b.files.includes(glob)).map(restriction)
    blocks.push({
      files: [glob],
      ignores: VENDOR_SDK_EXEMPT,
      rules: { 'no-restricted-imports': stillRestricted.length ? ['error', { patterns: stillRestricted }] : 'off' },
    })
  }
  return blocks
}
