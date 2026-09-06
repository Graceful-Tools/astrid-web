#!/usr/bin/env node
/**
 * Copy the browser bundles the service worker needs out of node_modules into
 * public/vendor (task eea00b1b).
 *
 * public/sw.js used to importScripts() Dexie from unpkg. A service worker runs
 * on every page load with access to the cache and to credentialed requests, so
 * a compromised CDN or a hijacked package meant arbitrary, persistent code in
 * every user's browser — and it forced script-src to allow https://unpkg.com,
 * which is all of npm.
 *
 * Run as part of the build so the vendored copy cannot drift from the version
 * package.json pins. Verified by tests/lib/vendor-assets.test.ts.
 */

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/** source in node_modules -> destination under public/vendor */
export const VENDOR_ASSETS = [
  { pkg: 'dexie', from: 'dist/dexie.min.js', to: 'dexie.min.js' },
]

function main() {
  mkdirSync(join(ROOT, 'public/vendor'), { recursive: true })

  for (const asset of VENDOR_ASSETS) {
    const source = join(ROOT, 'node_modules', asset.pkg, asset.from)
    const destination = join(ROOT, 'public/vendor', asset.to)
    copyFileSync(source, destination)

    const version = JSON.parse(
      readFileSync(join(ROOT, 'node_modules', asset.pkg, 'package.json'), 'utf8')
    ).version
    console.log(`✅ vendored ${asset.pkg}@${version} -> public/vendor/${asset.to}`)
  }
}

main()
