/**
 * Stand-ins for Prisma rows in mocked query results.
 *
 * WHY (AWTD-916). A Prisma row has every column on it, and a test that mocks
 * `findUnique` almost never has an opinion about more than three or four of
 * them. Spelling out thirty columns would bury the two the test is about, so
 * the tree had settled on `mockResolvedValue({ ... } as never)` — which does
 * silence the compiler, and also switches off every check on the fields that
 * ARE written. A misspelled column or a string where the schema says Date
 * reads exactly the same as a correct fixture.
 *
 * `row()` keeps the omissions and takes back the checking: `Partial<T>` means
 * you may leave any column out, but a column you do write must exist and must
 * have the right type. `T` is inferred from the mock's own parameter type, so
 * call sites read `mockResolvedValue(row({ id: 'x' }))` with no annotation.
 *
 * This is the deliberate escape hatch the task's acceptance criteria allow —
 * "kept, with a reason, where the fixture genuinely cannot be typed" — rather
 * than a cast that hides a wrong shape.
 */

// `NoInfer` is what makes this work. Without it TypeScript infers `T` from the
// argument — so `row({ id: 'x' })` returns `{ id: string }` and fails at the
// mock exactly as the bare literal did. Blocking inference on the parameter
// forces `T` to come from the call's CONTEXT, i.e. the mock's own row type,
// which is the whole point.

/** One partial row. */
export function row<T>(fields: NoInfer<Partial<T>>): T {
  return fields as T
}

/** A page of partial rows, for `findMany`. */
export function rows<T>(items: NoInfer<Partial<T>>[]): T[] {
  return items as T[]
}

/**
 * A row from a query with `include` or `select`.
 *
 * Prisma's base row type has only the table's own columns, so a mock for
 * `findUnique({ include: { owner: true } })` legitimately carries an `owner`
 * that `Partial<T>` rejects. This variant allows those extra keys — but a key
 * that IS a real column is still checked, because the intersection has to
 * satisfy `T[k]` as well. Weaker than `row()`, still far stronger than
 * `as never`. (AWTD-916)
 */
export function rowWith<T>(fields: NoInfer<Partial<T>> & Record<string, unknown>): T {
  return fields as T
}

/** A page of `rowWith` rows. */
export function rowsWith<T>(items: (NoInfer<Partial<T>> & Record<string, unknown>)[]): T[] {
  return items as T[]
}
