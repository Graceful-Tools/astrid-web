/**
 * JSON-lines logging with a redaction backstop.
 *
 * The gateway never passes a token or the shared secret to the logger on
 * purpose. The redactor is the second line: every value registered with it
 * (the shared secret for the process lifetime, each user token for the life of
 * its turn) is replaced before a line is written, so a mistake elsewhere still
 * cannot print one.
 */

export type LogLevel = 'info' | 'warn' | 'error'
export type Log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => void

export class Redactor {
  private readonly secrets = new Map<string, number>()

  add(value: string): void {
    if (!value) return
    this.secrets.set(value, (this.secrets.get(value) ?? 0) + 1)
  }

  remove(value: string): void {
    const count = this.secrets.get(value)
    if (count === undefined) return
    if (count <= 1) this.secrets.delete(value)
    else this.secrets.set(value, count - 1)
  }

  scrub(text: string): string {
    let out = text
    for (const secret of this.secrets.keys()) {
      if (out.includes(secret)) out = out.split(secret).join('[redacted]')
    }
    return out
  }
}

export function createLog(redactor: Redactor, write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Log {
  return (level, message, meta = {}) => {
    const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...meta })
    write(redactor.scrub(line))
  }
}
