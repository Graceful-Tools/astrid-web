/**
 * An in-memory stand-in for the slice of `@upstash/redis` the realtime bus uses
 * (AWTD-1459): ZADD, ZREMRANGEBYSCORE, EXPIRE and ZRANGE BYSCORE, singly or in
 * a pipeline.
 *
 * Shaped like the real client in the one way that matters to the bus: members
 * written as JSON strings come back DESERIALISED (Upstash's
 * `automaticDeserialization`, on by default). Several fakes can share one
 * `FakeUpstashStore`, which is how a test models two app instances talking to
 * one Upstash database.
 */

type Entry = { score: number; member: string }

export class FakeUpstashStore {
  readonly sets = new Map<string, Entry[]>()
  /** Every command any client sent, in order, as `[name, key]`. */
  readonly commands: Array<[string, string]> = []
  /** REST round trips: a pipeline counts once. */
  roundTrips = 0
  /** When set, the next round trip rejects with this error. */
  failNext: Error | null = null

  zadd(key: string, entry: Entry) {
    const set = this.sets.get(key) ?? []
    if (!set.some(e => e.member === entry.member)) set.push(entry)
    set.sort((a, b) => a.score - b.score)
    this.sets.set(key, set)
    return 1
  }

  zremrangebyscore(key: string, min: number, max: number) {
    const set = this.sets.get(key) ?? []
    const kept = set.filter(e => e.score < min || e.score > max)
    this.sets.set(key, kept)
    return set.length - kept.length
  }

  zrangeByScore(key: string, min: string | number, max: string | number) {
    const bound = (raw: string | number, isMin: boolean) => {
      const s = String(raw)
      if (s === '+inf') return { v: Infinity, ex: false }
      if (s === '-inf') return { v: -Infinity, ex: false }
      if (s.startsWith('(')) return { v: Number(s.slice(1)), ex: true }
      return { v: Number(s), ex: false, isMin }
    }
    const lo = bound(min, true)
    const hi = bound(max, false)
    return (this.sets.get(key) ?? [])
      .filter(e => (lo.ex ? e.score > lo.v : e.score >= lo.v) && (hi.ex ? e.score < hi.v : e.score <= hi.v))
      .map(e => deserialize(e.member))
  }

  trip() {
    this.roundTrips++
    if (this.failNext) {
      const error = this.failNext
      this.failNext = null
      throw error
    }
  }
}

function deserialize(member: string): unknown {
  try {
    return JSON.parse(member)
  } catch {
    return member
  }
}

/** A client over a shared store. Every method is one REST round trip. */
export function createFakeUpstash(store: FakeUpstashStore) {
  const client = {
    async zadd(key: string, entry: Entry) {
      store.trip()
      store.commands.push(['zadd', key])
      return store.zadd(key, entry)
    },
    async zremrangebyscore(key: string, min: number, max: number) {
      store.trip()
      store.commands.push(['zremrangebyscore', key])
      return store.zremrangebyscore(key, min, max)
    },
    async expire(key: string, _seconds: number) {
      store.trip()
      store.commands.push(['expire', key])
      return 1
    },
    async zrange(key: string, min: string | number, max: string | number, opts?: { byScore?: boolean }) {
      store.trip()
      store.commands.push(['zrange', key])
      if (!opts?.byScore) throw new Error('fake-upstash only supports BYSCORE ranges')
      return store.zrangeByScore(key, min, max)
    },
    pipeline() {
      const queued: Array<() => unknown> = []
      const p = {
        zadd(key: string, entry: Entry) {
          queued.push(() => { store.commands.push(['zadd', key]); return store.zadd(key, entry) })
          return p
        },
        zremrangebyscore(key: string, min: number, max: number) {
          queued.push(() => { store.commands.push(['zremrangebyscore', key]); return store.zremrangebyscore(key, min, max) })
          return p
        },
        expire(key: string, _seconds: number) {
          queued.push(() => { store.commands.push(['expire', key]); return 1 })
          return p
        },
        async exec() {
          store.trip()
          return queued.map(run => run())
        },
      }
      return p
    },
  }
  return client
}

/** Write an event the way another app instance would have (same member shape). */
export function writeRemoteEvent(store: FakeUpstashStore, userId: string, event: unknown, timestamp: number, id = `remote-${timestamp}-${Math.random()}`) {
  store.zadd(`sse:events:${userId}`, { score: timestamp, member: JSON.stringify({ event, timestamp, n: id }) })
}
