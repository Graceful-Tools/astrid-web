/**
 * The GitHub this deployment talks to (spec §7.2, §8.8).
 *
 * github.com by default. A GHE.com data-residency tenant — and later GitHub
 * Enterprise Server — sets these two instead of forking every call site.
 * tests/rules/github-access-goes-through-lib-github.test.ts keeps the hosts out
 * of everywhere else.
 */

function base(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/\/+$/, '')
}

/** REST and GraphQL API root, e.g. https://api.github.com */
export const GITHUB_API_URL = base(process.env.GITHUB_API_URL, 'https://api.github.com')

/** Web root for OAuth and links, e.g. https://github.com */
export const GITHUB_WEB_URL = base(process.env.GITHUB_WEB_URL, 'https://github.com')
