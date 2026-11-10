export class NextRequest extends Request {}

export function after() {
  throw new Error('after requires a Next.js request scope')
}

export class NextResponse extends Response {
  static json(body, init = {}) {
    const headers = new Headers(init.headers)
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    return new NextResponse(JSON.stringify(body), { ...init, headers })
  }
}
