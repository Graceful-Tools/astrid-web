/**
 * Brand values resolved at RUNTIME, so one image can serve any brand (AWTD-1587).
 *
 * `NEXT_PUBLIC_*` values are inlined at build. That made every brand a separate image:
 * the published GHCR image could only ever be Astrid. Every brand read now goes through
 * `brandEnv('NEXT_PUBLIC_BRAND_X', <the literal process.env read of that name>)`:
 *
 *   - On the server, the process environment at runtime wins, read with a computed key
 *     that Next cannot inline. A self-hosted container sets it from a mounted profile
 *     (`BRAND_PROFILE`, deploy/self-host/load-env.mjs) or plain env.
 *   - In the browser, the server's resolved values arrive in `window.__ASTRID_BRAND_ENV__`,
 *     written by the root layout before any app code runs (lib/brand/client-env.tsx).
 *   - Otherwise, the literal read the caller passes: the value inlined at
 *     build, exactly as before. The caller writes it literally so Next still inlines it.
 *
 * Hosted Astrid on Vercel builds and runs with the same environment, so the runtime and
 * inlined values are the same value and nothing changes. The browser global is written
 * only in runtime-brand builds (ASTRID_RUNTIME_BRAND=true), so Astrid's pages stay static.
 */

/** The browser global the root layout writes the client-safe brand values into. */
export const BRAND_ENV_GLOBAL = '__ASTRID_BRAND_ENV__'

type BrandEnvGlobal = { [BRAND_ENV_GLOBAL]?: Record<string, string> }

/** The process environment at runtime, by computed key, so the bundler cannot inline it. */
function runtimeEnv(name: string): string | undefined {
  try {
    return typeof process === 'undefined' ? undefined : process.env[name]
  } catch {
    return undefined
  }
}

export function brandEnv(name: string, inlined: string | undefined): string | undefined {
  if (typeof window !== 'undefined') {
    const injected = (window as unknown as BrandEnvGlobal)[BRAND_ENV_GLOBAL]
    if (injected && Object.prototype.hasOwnProperty.call(injected, name)) return injected[name]
    return inlined
  }
  const value = runtimeEnv(name)
  return value !== undefined ? value : inlined
}

/** True in an image built to take its brand at runtime (the self-hosted image). */
export function isRuntimeBrandBuild(): boolean {
  // Server-only (the root layout), so a literal read is a runtime read here.
  return process.env.ASTRID_RUNTIME_BRAND?.trim().toLowerCase() === 'true'
}
