/**
 * A real SMTP server, in-process, that keeps what it is sent (AWTD-1466).
 *
 * The SMTP email transport is exercised over an actual socket conversation —
 * EHLO, MAIL FROM, RCPT TO, DATA — rather than by mocking nodemailer, so a
 * conformance test proves the message a relay receives, not the arguments a
 * library was called with. It advertises no STARTTLS and no AUTH: it is a
 * sink, like mailpit in the self-host compose (`--profile mail`), only with no
 * container to start.
 */

import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import PostalMime from 'postal-mime'

export interface ReceivedEmail {
  envelopeFrom: string
  envelopeTo: string[]
  from: string
  to: string[]
  subject: string
  html: string
  text: string
  raw: string
}

export interface SmtpSink {
  /** `smtp://127.0.0.1:<port>`, what SMTP_URL is set to. */
  url: string
  received: ReceivedEmail[]
  close(): Promise<void>
}

function address(command: string): string {
  return command.match(/<([^>]*)>/)?.[1] ?? ''
}

async function parse(raw: string, envelopeFrom: string, envelopeTo: string[]): Promise<ReceivedEmail> {
  const email = await PostalMime.parse(raw)
  return {
    envelopeFrom,
    envelopeTo,
    from: email.from?.address ?? '',
    to: (email.to ?? []).map(to => to.address ?? ''),
    subject: email.subject ?? '',
    html: email.html ?? '',
    text: email.text ?? '',
    raw,
  }
}

function session(socket: Socket, received: ReceivedEmail[]) {
  let buffer = ''
  let inData = false
  let dataLines: string[] = []
  let envelopeFrom = ''
  let envelopeTo: string[] = []
  const reply = (line: string) => socket.write(`${line}\r\n`)

  reply('220 smtp-sink ready')
  socket.on('data', async chunk => {
    buffer += chunk.toString('utf8')
    let index: number
    while ((index = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      if (inData) {
        if (line === '.') {
          inData = false
          // Dot-unstuffing (RFC 5321 §4.5.2).
          const raw = dataLines.map(l => (l.startsWith('..') ? l.slice(1) : l)).join('\r\n')
          received.push(await parse(raw, envelopeFrom, envelopeTo))
          dataLines = []
          reply('250 OK queued')
        } else {
          dataLines.push(line)
        }
        continue
      }
      const verb = line.slice(0, 4).toUpperCase()
      if (verb === 'EHLO' || verb === 'HELO') reply('250 smtp-sink')
      else if (verb === 'MAIL') {
        envelopeFrom = address(line)
        envelopeTo = []
        reply('250 OK')
      } else if (verb === 'RCPT') {
        envelopeTo.push(address(line))
        reply('250 OK')
      } else if (verb === 'DATA') {
        inData = true
        reply('354 End data with <CR><LF>.<CR><LF>')
      } else if (verb === 'RSET' || verb === 'NOOP') reply('250 OK')
      else if (verb === 'QUIT') {
        reply('221 Bye')
        socket.end()
      } else reply('502 Command not implemented')
    }
  })
}

export async function startSmtpSink(): Promise<SmtpSink> {
  const received: ReceivedEmail[] = []
  const sockets = new Set<Socket>()
  const server: Server = createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    session(socket, received)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `smtp://127.0.0.1:${port}`,
    received,
    close: () =>
      new Promise<void>(resolve => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}
