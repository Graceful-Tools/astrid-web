#!/usr/bin/env tsx

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const root = process.cwd()
const sourceRoots = ["app", "components", "hooks", "lib", "services"]
const sourceExtensions = new Set([".ts", ".tsx"])

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

function extension(path: string): string {
  const dot = path.lastIndexOf(".")
  return dot === -1 ? "" : path.slice(dot)
}

function lineCount(source: string): number {
  return source.length === 0 ? 0 : source.split(/\r?\n/).length
}

const sourceFiles = sourceRoots
  .flatMap(directory => filesUnder(join(root, directory)))
  .filter(path => sourceExtensions.has(extension(path)))

const sources = sourceFiles.map(path => {
  const source = readFileSync(path, "utf8")
  return {
    path: relative(root, path),
    source,
    lines: lineCount(source),
  }
})

const routeFiles = filesUnder(join(root, "app/api"))
  .filter(path => path.endsWith("/route.ts"))
  .filter(path => !path.includes("/app/api/v1/"))

const routePairs = routeFiles.flatMap(legacyPath => {
  const route = relative(join(root, "app/api"), legacyPath)
  const v1Path = join(root, "app/api/v1", route)
  try {
    const legacySource = readFileSync(legacyPath, "utf8")
    const v1Source = readFileSync(v1Path, "utf8")
    return [{
      route,
      legacyLines: lineCount(legacySource),
      v1Lines: lineCount(v1Source),
      directReexport: /export\s*\{[^}]+\}\s*from\s*["'][^"']+["']/.test(v1Source),
    }]
  } catch {
    return []
  }
})

const rawApiFetch = /fetch\s*\(\s*["'`]\/api\//g
const metrics = {
  generatedFrom: "current checkout",
  sourceFiles: sources.length,
  largestSourceFile: sources
    .map(({ path, lines }) => ({ path, lines }))
    .sort((a, b) => b.lines - a.lines)[0],
  sourceFilesOver1000Lines: sources.filter(file => file.lines > 1_000).length,
  prismaImporters: sources.filter(file => file.source.includes("@/lib/prisma")).length,
  apiHelperImporters: sources.filter(file => file.source.includes("@/lib/api")).length,
  v1ResponseImporters: sources.filter(file => file.source.includes("@/lib/v1-response")).length,
  rawApiFetchFiles: sources.filter(file => {
    rawApiFetch.lastIndex = 0
    return rawApiFetch.test(file.source)
  }).length,
  rawApiFetchCalls: sources.reduce((count, file) => {
    rawApiFetch.lastIndex = 0
    return count + [...file.source.matchAll(rawApiFetch)].length
  }, 0),
  legacyV1RoutePairs: routePairs.length,
  directReexportLegacyV1RoutePairs: routePairs.filter(pair => pair.directReexport).length,
  nonReexportLegacyV1RoutePairs: routePairs.filter(pair => !pair.directReexport).length,
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(metrics, null, 2))
} else {
  console.log("# Refactoring metrics")
  for (const [name, value] of Object.entries(metrics)) {
    console.log(`${name}: ${typeof value === "object" ? JSON.stringify(value) : value}`)
  }
}
