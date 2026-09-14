# Spec: encrypting contact email addresses

**Status:** proposal, not implemented. Filed as AWTD-940, out of AWTD-938.

`AddressBookContact.name` and `.phoneNumber` are encrypted at rest.
`.email` is **not**. This says what it would take to change that, what it
would cost, and what I recommend.

## Verified current state

Checked against production on 2026-09-14, read-only:

```
total contacts: 4793      users with contacts: 4
max per user:   2671      median per user:     404
email plaintext? yes      name encrypted? yes
```

The asymmetry is deliberate in effect if not in intent: `email` is the
column everything *queries*, and the other two are the columns nothing
queries.

## Why this is not a one-line change

Five things depend on `email` being plaintext and comparable in SQL.

| # | Where | What it does | Survives encryption? |
|---|---|---|---|
| 1 | `@@unique([userId, email])` | dedupes an upload | ✗ — AES-GCM uses a random IV, so the same address encrypts differently every time and duplicates stop colliding |
| 2 | `contacts/recommended` step 2 | `User.email IN (myContactEmails)` — the cross-table join that answers "which of my contacts are on Astrid" | ✗ — joins encrypted contacts against plaintext `User.email` |
| 3 | `contacts/recommended` step 3 | `email: currentUser.email.toLowerCase()` — reciprocity | ✗ equality on ciphertext |
| 4 | `@@index([email])` | makes #3 cheap | ✗ |
| 5 | `contacts/search` | `email: { contains: query, mode: 'insensitive' }` | ✗ — **and this one has no cryptographic answer at all** |

Items 1–4 are solvable. Item 5 is the decision.

## Items 1–4: a blind index

Store a deterministic keyed hash alongside the ciphertext.

```prisma
model AddressBookContact {
  email     String   // becomes ciphertext: enc:v1:<iv>:<tag>:<data>
  emailHash String   // HMAC-SHA256(BLIND_INDEX_KEY, normalized email), hex
  @@unique([userId, emailHash])
  @@index([emailHash])
}
```

`encryptField` is non-deterministic by design — that is correct for
confidentiality and exactly what makes it unusable as a key. The HMAC is
deterministic, so equality and uniqueness work on it.

**#2 needs the same hash on the other side of the join.** The query matches
contacts against `User.email`, so `User` needs `emailHash` too, computed on
write and backfilled. Without it there is no way to ask "which users are in
this set" once the set is ciphertext. This is the part most likely to be
underestimated: it is a change to the `User` table, not just to contacts.

Use a **separate key** from `ENCRYPTION_KEY`. A blind index is a controlled
leak — it reveals equality, and for a low-entropy domain like email it is
brute-forceable if the key is ever exposed. Keeping it distinct means
rotating one does not force rotating the other.

## Item 5: search is the real cost

`contacts/search` filters with `contains`. No blind index supports substring
matching; that is not an implementation gap, it is what deterministic hashing
means.

The code already says what happens when a searched column gets encrypted:

```ts
// Search contacts - only by email since name is encrypted
// Note: name field is encrypted so we can't search it in the database
```

So `name` search was already lost to encryption, and `email` is the *only*
remaining searchable field. Encrypting it leaves contact search with nothing
to search.

**The way out is to stop searching in SQL.** Load the caller's contacts,
decrypt, filter in application code. The numbers above say this is fine: the
heaviest real user has 2,671 contacts, and the query is already scoped by
`userId`. Decrypting a few thousand rows is single-digit milliseconds, and it
would restore **name** search, which has been broken since name was
encrypted. Search would get better, not worse.

It stops being fine if someone uploads 50k contacts. There is currently no
cap on upload size — worth adding one alongside this, independent of whether
the rest ships.

## Migration

The decrypt path already tolerates plaintext:

```ts
if (!isEncrypted(value)) return value   // backwards compatibility
```

So this can run forward-only, without a flag day:

1. Add `emailHash` to both tables, nullable. Backfill. (Read-only until step 3.)
2. Write both: ciphertext to `email`, HMAC to `emailHash`. Keep reads on
   plaintext `email`, which still works for rows not yet migrated.
3. Move every read in the table above to `emailHash`, and search to the
   application layer.
4. Backfill-encrypt remaining plaintext rows.
5. Add `NOT NULL` + the unique constraint; drop `@@index([email])`.

Steps 1–4 are individually reversible. Only step 5 is one-way.

**The existing `@@unique([userId, email])` must be dropped before step 4**,
or encrypting a row whose address duplicates another user's will not conflict
where it used to, and dedupe behaviour changes silently mid-migration.

## What this actually buys

Worth being honest, since it is a non-trivial change touching `User`.

- **Gain:** a database dump, a leaked backup, or read access to one table no
  longer yields a list of email addresses belonging to people who never signed
  up. Contacts are third-party personal data, which is the strongest argument
  here — those people did not consent to us holding it.
- **Not a gain:** anyone with application-level access still reads them, since
  the app must decrypt to function. This is protection against data at rest
  leaving, not against compromise of the running system.
- **Residual leak:** `emailHash` still reveals *equality* across users. That
  is how #2 and #3 work; it cannot be removed without removing the feature.

## Recommendation

Do it, but in this order, and treat step 5 of the previous section as a
separate decision from steps 1–4:

1. **Cap the upload size first.** Independent, small, and it is the
   precondition that makes application-layer search safe.
2. **Move search to the application layer before encrypting anything.** It is
   a pure refactor while email is still plaintext, it is independently
   testable, and it restores name search on its own. If this step proves hard,
   the rest should not proceed.
3. Then the blind index and migration above.

If only one thing is done, do (2). It has value regardless, and it is where
the risk in the whole proposal sits.
