/**
 * Kept free of imports so a client component can build the same object as the
 * server (components/reminder-provider.tsx) without bundling the server's locale
 * loader.
 */

/** Either translator over `notifications`: next-intl's server `createTranslator` or the client `useTranslations`. */
 
type LabelTranslator = (key: any, values?: any) => string

/**
 * The service worker's own words, rendered for one user (AWTD-1592).
 *
 * public/sw.js has no language: a push can wake it with no page open, and it
 * cannot import the locale files. So every push carries these in `data.labels`,
 * and the page hands the same object over for the reminders it schedules
 * (`SET_LABELS`). `{title}` and `{minutes}` are left in for the worker to fill.
 * A payload without labels — one sent before this — keeps the worker's English.
 */
export function workerLabels(t: LabelTranslator) {
  return {
    openApp: t('actions.openApp'),
    dismiss: t('actions.dismiss'),
    viewTask: t('actions.viewTask'),
    snooze15: t('actions.snooze15'),
    markComplete: t('actions.markComplete'),
    reminderTitle: t('worker.reminderTitle'),
    dueTitle: t('worker.dueTitle'),
    dueNowBody: t('worker.dueNowBody', { title: '{title}' }),
    overdueTitle: t('push.overdueTitle'),
    overdueBody: t('push.overdueBody', { title: '{title}' }),
    snoozedTitle: t('worker.snoozedTitle'),
    snoozedBody: t('worker.snoozedBody', { minutes: '{minutes}' }),
    snoozeFailedTitle: t('worker.snoozeFailedTitle'),
    snoozeFailedBody: t('worker.snoozeFailedBody'),
    completedTitle: t('worker.completedTitle'),
    completedBody: t('worker.completedBody'),
    completeFailedTitle: t('worker.completeFailedTitle'),
    completeFailedBody: t('worker.completeFailedBody'),
  }
}

export type WorkerLabels = ReturnType<typeof workerLabels>
