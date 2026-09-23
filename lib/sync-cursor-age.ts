/**
 * How old a delta-sync cursor may be before a client must do a FULL fetch.
 *
 * Deletions reach an incremental client only as tombstones (lib/deletion-log.ts),
 * and tombstones are pruned after DELETION_LOG_RETENTION_DAYS. A cursor older
 * than that would ask for deletions the server has already forgotten, and the
 * client would keep deleted rows on screen with nothing raising anything. So
 * every incremental path caps its cursor here, and the retention test asserts
 * this is far shorter than retention (AWTD-993).
 *
 * Prisma-free on purpose: the browser sync code imports it.
 */
export const SYNC_CURSOR_MAX_AGE_MS = 24 * 60 * 60 * 1000
