/**
 * Frozen wire-protocol header names.
 *
 * These are NOT branding. They are part of the published webhook contract: outbound
 * subscribers and self-hosted Claude Code Remote servers verify HMAC signatures by
 * exact header name, so renaming them with the brand would silently break every
 * already-deployed integration — signatures would arrive under a header the receiver
 * does not read, and be treated as unsigned.
 *
 * A fork inherits these names, exactly as it inherits the JSON field names in the same
 * payloads. If a fork ever wants its own header namespace, that is a breaking protocol
 * change with a migration, not a build-time switch.
 *
 * Task 97208a72 — kept literal deliberately; `check:reuse` exempts this file.
 */

/** `sha256=<hmac>` over the request body. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-Astrid-Signature'

/** Unix milliseconds, part of the signed payload to bound replay. */
export const WEBHOOK_TIMESTAMP_HEADER = 'X-Astrid-Timestamp'

/** Event name, e.g. `task.assigned`. */
export const WEBHOOK_EVENT_HEADER = 'X-Astrid-Event'
