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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly coreVersion: (a: number) => void;
    readonly kinds: (a: number) => void;
    readonly runJson: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
