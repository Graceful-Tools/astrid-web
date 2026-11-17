/* tslint:disable */
/* eslint-disable */

/**
 * The crate version this build came from, for a caller's logs.
 */
export function coreVersion(): string;

/**
 * The `kind` of every rule this build answers, sorted — `astrid_rules::rules::kinds`.
 *
 * The browser package answers fewer rules than the Node one (docs/BROWSER_DOOR.md), so a caller
 * can choose per rule, with the core or with its own copy, rather than discover a refusal.
 */
export function kinds(): string[];

/**
 * Answer one rule given as JSON, as JSON — `astrid_rules::rules::run_json`.
 *
 * Never throws for a bad request: an unreadable one comes back as
 * `{"ok":false,"error":{"kind":"badRequest",…}}`, the same envelope as every other answer.
 */
export function runJson(request: string): string;
