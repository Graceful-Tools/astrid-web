// Stand-in for astrid-web's @/lib/prisma.
//
// Importing the real client opens a database connection at module load, which would make fixture
// generation require a database. Nothing a contract driver calls issues a query; this exists only
// so a module that imports prisma at the top level can be loaded for the pure functions beside it.
//
// Every property throws rather than returning undefined: if a driver ever does reach the database,
// that must fail loudly instead of quietly exporting a fixture built from nulls.
export const prisma = new Proxy({}, {
  get(_target, prop) {
    throw new Error(`contract drivers must not touch the database (prisma.${String(prop)})`)
  },
})
export default prisma
