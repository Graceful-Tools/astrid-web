/**
 * ADEV-126: does the documented image tag exist on GHCR?
 *
 * Pure helpers; scripts/check-image-tag-published.ts does the network calls.
 */
export const IMAGE_REPOSITORY = "graceful-tools/astrid-web"

/** The OCI index/manifest types a registry may answer a tag with. */
export const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ")

/** The tag SELF_HOSTING.md tells a partner to pull (`IMAGE_TAG=1.4.0`), or null. */
export function documentedTag(selfHostingMarkdown: string): string | null {
  return /^IMAGE_TAG=(\d+\.\d+\.\d+)$/m.exec(selfHostingMarkdown)?.[1] ?? null
}

/** The two images a release publishes for a tag: the app and its migrator. */
export function tagsToCheck(tag: string): string[] {
  return [tag, `${tag}-migrator`]
}

export function manifestUrl(tag: string): string {
  return `https://ghcr.io/v2/${IMAGE_REPOSITORY}/manifests/${tag}`
}

export const TOKEN_URL = `https://ghcr.io/token?scope=repository:${IMAGE_REPOSITORY}:pull`

export interface TagResult {
  tag: string
  status: number
}

/** One line per tag that is not a 200; empty means every tag is published. */
export function failures(results: TagResult[]): string[] {
  return results
    .filter(r => r.status !== 200)
    .map(r => `ghcr.io/${IMAGE_REPOSITORY}:${r.tag} answered ${r.status || "no response"}, not 200`)
}
