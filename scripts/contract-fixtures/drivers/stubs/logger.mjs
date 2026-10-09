// No-op stand-in for astrid-web's @/lib/logger.
//
// The canonical functions a contract driver calls log only behind a dev-only debug flag
// (canUserEditTask's NEXT_PUBLIC_DEBUG_PERMISSIONS block, for one), so what the logger does cannot
// affect a return value. The real module pulls in pino and its transports.
const noop = () => {}
const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop }
export const createLogger = () => logger
export default logger
