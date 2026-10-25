/* tslint:disable */
/* eslint-disable */

/**
 * The crate version this build came from, for a caller's logs.
 */
export function coreVersion(): string;

/**
 * Answer one rule given as JSON, as JSON — `astrid_rules::rules::run_json`.
 *
 * Never throws for a bad request: an unreadable one comes back as
 * `{"ok":false,"error":{"kind":"badRequest",…}}`, the same envelope as every other answer.
 */
export function runJson(request: string): string;
