// An in-memory stand-in for the one table lib/reminder-snooze.ts reads and writes.
//
// The snooze rule — refuse another's reminder, refuse a sixth snooze, move `scheduledFor` to now
// plus the minutes, keep the first `originalScheduledFor` — sits between two prisma calls, so
// running it needs something answering `reminderQueue.findUnique` and `reminderQueue.update`.
// This answers exactly those two from a Map the reminders driver fills, and throws on anything
// else, so a change in what the rule touches fails the export loudly.
export const reminderRows = new Map()

const reminderQueue = {
  async findUnique({ where }) {
    const row = reminderRows.get(where.id)
    return row ? structuredClone(row) : null
  },
  async update({ where, data }) {
    const row = reminderRows.get(where.id)
    if (!row) throw new Error(`no reminder ${where.id}`)
    Object.assign(row, structuredClone(data))
    return structuredClone(row)
  },
}

export const prisma = new Proxy({ reminderQueue }, {
  get(target, prop) {
    if (prop in target) return target[prop]
    throw new Error(`reminders driver: lib/reminder-snooze.ts reached prisma.${String(prop)}`)
  },
})
export default prisma
