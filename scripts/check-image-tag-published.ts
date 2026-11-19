#!/usr/bin/env tsx

/**
 * ADEV-126: fail unless the image tag SELF_HOSTING.md documents exists on GHCR,
 * for both the app and its `-migrator`. Anonymous, as a partner pulls.
 *
 * The offline test (tests/rules/documented-image-tag-agrees.test.ts) only proves
 * the docs agree with each other; before v1.4.0 was published all three agreed
 * on a tag GHCR did not have.
 *
 *   npx tsx scripts/check-image-tag-published.ts [<tag>]
 *
 * Run by .github/workflows/image-tag-published.yml (schedule) and as the last
 * job of release-image.yml.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  MANIFEST_ACCEPT,
  TOKEN_URL,
  documentedTag,
  failures,
  manifestUrl,
  tagsToCheck,
  type TagResult,
} from "./lib/image-tag-published"

async function main(): Promise<number> {
  const tag =
    process.argv[2] ??
    documentedTag(readFileSync(join(process.cwd(), "docs/deployment/SELF_HOSTING.md"), "utf8"))
  if (!tag) {
    console.error("No IMAGE_TAG=<x.y.z> line found in docs/deployment/SELF_HOSTING.md")
    return 1
  }

  const tokenResponse = await fetch(TOKEN_URL)
  if (!tokenResponse.ok) {
    console.error(`GHCR token request answered ${tokenResponse.status}`)
    return 1
  }
  const { token } = (await tokenResponse.json()) as { token?: string }
  if (!token) {
    console.error("GHCR token response carried no token")
    return 1
  }

  const results: TagResult[] = []
  for (const t of tagsToCheck(tag)) {
    const response = await fetch(manifestUrl(t), {
      headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT },
    }).catch(() => null)
    results.push({ tag: t, status: response?.status ?? 0 })
  }

  const problems = failures(results)
  if (problems.length > 0) {
    console.error(problems.join("\n"))
    return 1
  }
  console.log(`Published on GHCR: ${results.map(r => r.tag).join(", ")}`)
  return 0
}

main().then(
  code => process.exit(code),
  err => {
    console.error(err)
    process.exit(1)
  }
)
