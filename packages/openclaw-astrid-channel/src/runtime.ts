import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setAstridRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getAstridRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Astrid runtime not initialized");
  }
  return runtime;
}
