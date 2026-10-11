// Stands in for astrid-web's @/lib/redis and @/lib/sse-utils.
//
// lib/list-manual-order.ts imports both beside the pure `sanitizeManualOrder` the manual-order
// driver calls. The real sse-utils starts two `setInterval` timers at import, which keeps Node
// alive forever (the export would hang, not fail); redis would try to connect. Nothing a driver
// calls reaches either, so each export throws on use: a driver that ever did would fail loudly.
const refuse = (name) => () => {
  throw new Error(`contract drivers must not reach ${name}`)
}
export const RedisCache = new Proxy({}, { get: (_t, prop) => refuse(`RedisCache.${String(prop)}`)() })
export const broadcastToUsers = refuse('broadcastToUsers')
export default {}
