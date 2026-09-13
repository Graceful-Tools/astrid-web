# Every dev route 500s: a corrupt `.next` manifest

**Symptom:** `npm run dev` reports `✓ Ready`, and then *every* route returns 500 — `/`
included, and any new throwaway route too. The server log repeats a JSON parse error that
names no file:

```
⨯ SyntaxError: Unexpected non-whitespace character after JSON at position 1739 (line 1 column 1740)
 GET / 500 in 256ms (next.js: 253ms, proxy.ts: 2ms, application-code: 0.9ms)
```

**Cause:** one unparseable `.json` file inside `.next`. The dev server parses a page's
`build-manifest.json` *before* it invokes the page, so a single bad file takes down every
route at once.

**Fix:** none needed by hand — `npm run dev` now repairs this itself. Read on only if you want
to know why it looks the way it does.

---

## Why it is so hard to recognise

Three things about this failure actively point away from the cause.

- **`application-code: 0.9ms`.** No application code ran, so nothing you changed can be at
  fault — and nothing in the app can be the fix either.
- **`npm run predeploy` is green at the same commit, build included.** `next build` writes and
  reads `.next/`, while `next dev` uses `.next/dev/`. They are different trees, so a corrupt
  dev manifest cannot fail a build. "Build passes, dev 500s" reads like a deep local
  toolchain problem rather than two stray bytes in a cache file.
- **Next names no file in the error.** You get a byte offset and nothing else.

The byte offset is the one real clue. `Unexpected non-whitespace character after JSON at
position N`, with N just short of the file's size, is the signature of a **torn write**:
shorter new content laid over longer old content, leaving the tail of the old file behind.
Finding it is a matter of looking for a `.json` under `.next` whose size is a little above N.
On AWTD-934 that was `.next/dev/server/app/[locale]/page/build-manifest.json` — 1763 bytes,
error at 1739.

## The guard

`scripts/check-next-cache.ts` runs as the `predev` npm script, so plain `npm run dev` is
enough. It parses every `.json` under `.next` (about 1500 files, ~0.5s), and if any fails it
names the file, prints Next's own error, and removes the affected tree so Next rebuilds it:

```
⚠️  1 unparseable file(s) in .next — this 500s every dev route:
   .next/dev/server/app/[locale]/page/build-manifest.json
     Unexpected non-whitespace character after JSON at position 1764 (line 40 column 1)
🧹 Removed .next/dev — Next will rebuild it on this run.
```

It clears **`.next/dev` alone** when only the dev tree is damaged, so a production build
sitting in `.next/` survives and does not have to be redone. Only if `.next/` itself is torn
does the whole directory go.

The guard always exits 0. A cache that has to be rebuilt makes `npm run dev` slower on that
one run; it is not a reason to refuse to start.

`npx tsx scripts/check-next-cache.ts --dry-run` reports without deleting, which is the way to
confirm a diagnosis before anything is thrown away.

The logic is in `scripts/lib/next-cache-integrity.ts` and is covered by
`tests/scripts/next-cache-integrity.test.ts`.

## Two things nearby that are NOT this bug

- **`/login` returns 404.** Correct — there is no `/login` route. Auth lives under
  `app/[locale]/auth/`.
- **`light-theme.css` CSS parse warnings in the dev log.** Real, but unrelated: they appear on
  a healthy boot serving 200s, and they show up in the same log frames as the 500 only because
  the stylesheet is imported by `app/[locale]/layout.tsx`.

`next-env.d.ts` flipping between `./.next/types/…` and `./.next/dev/types/…` is likewise not a
cause. It is generated, and Next rewrites it to point at whichever tree it last built, so it
shows up modified in `git status` after running dev. Revert it rather than committing the flip.

## If it somehow comes back

The manual recovery is what the guard automates:

```bash
rm -rf .next && npm run dev
```

Torn writes come from two processes writing one `.next` at the same time, or from a dev server
killed mid-write. Running `/fixall` in a locked working tree (docs/FIXALL_WORKFLOW.md → *One
session per working tree*) removes the first cause; the guard covers the rest.
