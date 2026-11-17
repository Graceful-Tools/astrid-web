/**
 * Where the /fixall loop's seen-file lives (task 055da8d0) is the SDK's now (ADEV-83):
 * `astrid-agent queue` keeps it, in the OS cache dir and never under node_modules
 * (packages/astrid-sdk/src/seen-file.ts). Re-exported so existing importers keep their path.
 */
export { adoptLegacySeenFile, defaultSeenFile, legacySeenFile } from '../../packages/astrid-sdk/src/seen-file'
