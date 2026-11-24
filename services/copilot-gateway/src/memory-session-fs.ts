/**
 * An in-memory session filesystem, one per session.
 *
 * The SDK in "empty" mode needs somewhere to keep session state. Giving it
 * this instead of a directory means nothing a session writes (its transcript,
 * which can include tool output) ever reaches the container's disk, and it is
 * gone when the session object is dropped at the end of the turn.
 *
 * Structurally implements the SDK's SessionFsProvider; sdk-client.ts checks the
 * fit against the real type.
 */

import { posix } from 'node:path'

interface Entry {
  kind: 'file' | 'directory'
  content: string
  birthtime: string
  mtime: string
}

function notFound(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' })
}

export class MemorySessionFs {
  private readonly entries = new Map<string, Entry>()

  constructor() {
    this.entries.set('/', this.entry('directory'))
  }

  private entry(kind: Entry['kind'], content = ''): Entry {
    const now = new Date().toISOString()
    return { kind, content, birthtime: now, mtime: now }
  }

  private norm(path: string): string {
    return posix.resolve('/', path)
  }

  private ensureParent(path: string): void {
    const parent = posix.dirname(path)
    const p = this.entries.get(parent)
    if (!p) {
      this.mkdirSync(parent, true)
    } else if (p.kind !== 'directory') {
      throw Object.assign(new Error(`ENOTDIR: '${parent}'`), { code: 'ENOTDIR' })
    }
  }

  async readFile(path: string): Promise<string> {
    const e = this.entries.get(this.norm(path))
    if (!e || e.kind !== 'file') throw notFound(path)
    return e.content
  }

  async writeFile(path: string, content: string): Promise<void> {
    const p = this.norm(path)
    this.ensureParent(p)
    const existing = this.entries.get(p)
    if (existing) {
      existing.content = content
      existing.mtime = new Date().toISOString()
    } else {
      this.entries.set(p, this.entry('file', content))
    }
  }

  async appendFile(path: string, content: string): Promise<void> {
    const p = this.norm(path)
    const existing = this.entries.get(p)
    await this.writeFile(p, (existing?.kind === 'file' ? existing.content : '') + content)
  }

  async exists(path: string): Promise<boolean> {
    return this.entries.has(this.norm(path))
  }

  async stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; size: number; mtime: string; birthtime: string }> {
    const e = this.entries.get(this.norm(path))
    if (!e) throw notFound(path)
    return {
      isFile: e.kind === 'file',
      isDirectory: e.kind === 'directory',
      size: Buffer.byteLength(e.content),
      mtime: e.mtime,
      birthtime: e.birthtime,
    }
  }

  async mkdir(path: string, recursive: boolean): Promise<void> {
    this.mkdirSync(path, recursive)
  }

  private mkdirSync(path: string, recursive: boolean): void {
    const p = this.norm(path)
    if (this.entries.has(p)) return
    const parent = posix.dirname(p)
    if (!this.entries.has(parent)) {
      if (!recursive) throw notFound(parent)
      this.mkdirSync(parent, true)
    }
    this.entries.set(p, this.entry('directory'))
  }

  private children(dir: string): string[] {
    const prefix = dir === '/' ? '/' : `${dir}/`
    const names: string[] = []
    for (const key of this.entries.keys()) {
      if (key !== dir && key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
        names.push(key.slice(prefix.length))
      }
    }
    return names.sort()
  }

  async readdir(path: string): Promise<string[]> {
    const p = this.norm(path)
    if (this.entries.get(p)?.kind !== 'directory') throw notFound(path)
    return this.children(p)
  }

  async readdirWithTypes(path: string): Promise<Array<{ name: string; type: 'file' | 'directory' }>> {
    const p = this.norm(path)
    return (await this.readdir(p)).map((name) => ({
      name,
      type: this.entries.get(posix.join(p, name))!.kind,
    }))
  }

  async rm(path: string, recursive: boolean, force: boolean): Promise<void> {
    const p = this.norm(path)
    const e = this.entries.get(p)
    if (!e) {
      if (force) return
      throw notFound(path)
    }
    if (e.kind === 'directory' && this.children(p).length > 0 && !recursive) {
      throw Object.assign(new Error(`ENOTEMPTY: '${path}'`), { code: 'ENOTEMPTY' })
    }
    for (const key of [...this.entries.keys()]) {
      if (key === p || key.startsWith(`${p}/`)) this.entries.delete(key)
    }
  }

  async rename(src: string, dest: string): Promise<void> {
    const s = this.norm(src)
    const d = this.norm(dest)
    if (!this.entries.has(s)) throw notFound(src)
    this.ensureParent(d)
    for (const [key, value] of [...this.entries.entries()]) {
      if (key === s || key.startsWith(`${s}/`)) {
        this.entries.delete(key)
        this.entries.set(d + key.slice(s.length), value)
      }
    }
  }
}
