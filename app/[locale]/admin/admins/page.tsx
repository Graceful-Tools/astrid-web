// Canonical direct child route. Keep the previous nested route working as a
// compatibility link while the shared admin navigation points here.
export { default } from '../analytics/admins/page'

// Next 16 reads route segment config statically and cannot follow a re-export, so
// `dynamic` is declared here rather than forwarded. It must stay in step with
// ../analytics/admins/page, which declares the same value.
export const dynamic = 'force-dynamic'
