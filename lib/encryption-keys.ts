/**
 * The encryption keyring: which key to encrypt with, and which to try on read.
 *
 * Rotating `ENCRYPTION_KEY` normally means `ENCRYPTION_KEY` = new plus
 * `ENCRYPTION_KEY_PREVIOUS` = old. That is impossible here: production's key is
 * a Vercel **Secret**, so its value cannot be read back, and populating a
 * "previous" variable means reading it first (task AWTD-1369).
 *
 * So the keyring is inverted:
 *
 *   ENCRYPTION_KEY       stays exactly as it is. Nobody needs to know its value
 *                        — production already has it injected at runtime.
 *   ENCRYPTION_KEY_NEXT  the new key, generated and recorded by a human.
 *
 * Decryption tries every key the ring holds; encryption uses the *current* one,
 * which becomes NEXT as soon as NEXT is set. `scripts/reencrypt-fields.ts` then
 * rewrites stored values under the current key. When it reports nothing left,
 * `ENCRYPTION_KEY` is set to the new value — which the human does know — and
 * NEXT is deleted. The old key is never read, never logged, never transits the
 * wire.
 *
 * Trying more than one key is safe because every format written here is
 * authenticated (AES-256-GCM): a wrong key fails the auth tag rather than
 * returning plausible garbage. Legacy AES-256-CBC values in
 * lib/api-key-cache.ts and lib/ai/credential-cipher.ts are NOT authenticated,
 * so a wrong key there yields either a padding error or mojibake. Those are
 * read-only legacy paths and their callers already treat a failure as "no
 * credential", so the risk is a credential that reads as absent, not one that
 * reads as wrong.
 */

/** aes-256 needs 32 bytes, which is 64 hex characters. */
const KEY_HEX_LENGTH = 64

const HEX = /^[0-9a-fA-F]+$/

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function assertKeyShape(name: string, value: string): string {
  if (value.length !== KEY_HEX_LENGTH || !HEX.test(value)) {
    // Deliberately never includes the value. `[SENSITIVE]` — what `vercel pull`
    // writes for a Secret it may not read — lands here, which is the point:
    // it is truthy, so a presence check would have let it through.
    throw new Error(
      `${name} must be ${KEY_HEX_LENGTH} hex characters (32 bytes for aes-256); got ${value.length} characters`,
    )
  }
  return value
}

/**
 * An index signature rather than the two named keys, so `process.env` itself is
 * assignable: this project narrows `NodeJS.ProcessEnv`, and a type listing only
 * these two names has no properties in common with it.
 */
export type EncryptionEnv = { readonly [key: string]: string | undefined }

/**
 * The ring's default source. Written out key by key rather than passing
 * `process.env` wholesale so that both variables are visible to
 * scripts/check-env-schema.ts, which finds reads by matching a literal
 * `process.env.` access — a variable reached only through a parameter reads to
 * it as unused, and
 * `npm run check:env` then reports .env.example describing a switch that does
 * nothing.
 */
function fromProcessEnv(): EncryptionEnv {
  return {
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    ENCRYPTION_KEY_NEXT: process.env.ENCRYPTION_KEY_NEXT,
  }
}

/**
 * Every key to try when reading, current first.
 *
 * Current first is about cost rather than correctness: once the re-encryption
 * pass has run, most stored values are under the new key, so trying it first
 * saves a failed decrypt per row.
 */
export function encryptionKeyHexes(env: EncryptionEnv = fromProcessEnv()): string[] {
  const primary = clean(env.ENCRYPTION_KEY)
  const next = clean(env.ENCRYPTION_KEY_NEXT)

  if (!primary && !next) {
    throw new Error('ENCRYPTION_KEY environment variable is required for field encryption')
  }

  if (primary && next && primary === next) {
    // Otherwise a rotation looks configured while doing nothing, and the pass
    // would report success having rewritten everything under the same key.
    throw new Error('ENCRYPTION_KEY_NEXT is the same as ENCRYPTION_KEY — that is not a rotation')
  }

  const keys: string[] = []
  if (next) keys.push(assertKeyShape('ENCRYPTION_KEY_NEXT', next))
  if (primary) keys.push(assertKeyShape('ENCRYPTION_KEY', primary))
  return keys
}

/** The key new values are written under. */
export function currentEncryptionKeyHex(env: EncryptionEnv = fromProcessEnv()): string {
  return encryptionKeyHexes(env)[0]
}

/** True once a rotation is in flight, which is what the pass checks. */
export function isRotationInProgress(env: EncryptionEnv = fromProcessEnv()): boolean {
  return encryptionKeyHexes(env).length > 1
}

/**
 * Run `attempt` against each key until one succeeds.
 *
 * A cipher failure under one key is expected mid-rotation and is not an error
 * worth surfacing — but a failure under *every* key is, so the last one is
 * rethrown rather than replaced with a message of our own, which would hide
 * what Node actually said. Non-`Error` throws and programming mistakes
 * propagate the same way: this retries, it does not swallow.
 */
export function tryEachKey<T>(env: EncryptionEnv, attempt: (keyHex: string) => T): T {
  const keys = encryptionKeyHexes(env)
  let lastError: unknown
  for (const keyHex of keys) {
    try {
      return attempt(keyHex)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
