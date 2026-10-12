// Stands in for the `@prisma/client` package. lib/list-manual-order.ts imports `Prisma` only to
// name a type (`as Prisma.JsonArray`); Node's type stripping keeps the import, so without this
// the manual-order driver would need astrid-web's generated client installed. Any use throws.
export const Prisma = new Proxy({}, {
  get(_target, prop) {
    throw new Error(`contract drivers must not use @prisma/client (Prisma.${String(prop)})`)
  },
})
export class PrismaClient {
  constructor() {
    throw new Error('contract drivers must not construct a PrismaClient')
  }
}
